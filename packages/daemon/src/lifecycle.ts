import { readFileSync, unlinkSync } from 'node:fs';

/** Minimal seams for shutting the daemon down without orphaning agent children. */
export interface WorkspaceLockIo {
  read(path: string): string;
  unlink(path: string): void;
}

const nodeWorkspaceLockIo: WorkspaceLockIo = {
  read: (path) => readFileSync(path, 'utf8'),
  unlink: (path) => unlinkSync(path),
};

/**
 * Remove only the exact lock claim this process observed or created. A stale
 * reader must never unlink a newer daemon's ownership record.
 */
export function removeWorkspaceLockIfOwned(
  path: string,
  expectedClaim: string,
  io: WorkspaceLockIo = nodeWorkspaceLockIo,
): boolean {
  try {
    if (io.read(path) !== expectedClaim) return false;
    io.unlink(path);
    return true;
  } catch {
    return false;
  }
}
export interface CloseableServer {
  close(callback?: (error?: Error) => void): CloseableServer;
}

export interface ShutdownTimer {
  unref?(): void;
}

export interface DaemonShutdownOptions {
  readonly server: CloseableServer;
  readonly release: () => void;
  readonly exit: (code: number) => void;
  readonly timeoutMs?: number;
  readonly schedule?: (callback: () => void, timeoutMs: number) => ShutdownTimer;
  readonly cancel?: (timer: ShutdownTimer) => void;
}

/**
 * Ensure teardown that affects active requests happens before Node starts
 * waiting for those requests to finish. The preparation itself is idempotent,
 * even if more than one caller asks the server to close.
 */
export function installBeforeServerClose(server: CloseableServer, beforeClose: () => void): void {
  const nativeClose = server.close.bind(server);
  let prepared = false;

  server.close = (callback?: (error?: Error) => void): CloseableServer => {
    if (!prepared) {
      prepared = true;
      beforeClose();
    }
    return nativeClose(callback);
  };
}

/**
 * Return one signal handler that drains the HTTP server, releases the workspace
 * exactly once, and cannot wait forever on an open socket.
 */
export function createDaemonShutdown(options: DaemonShutdownOptions): () => void {
  const schedule = options.schedule ?? ((callback, timeoutMs) => setTimeout(callback, timeoutMs));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
  const timeoutMs = options.timeoutMs ?? 3_000;
  let shuttingDown = false;
  let finished = false;
  let fallback: ShutdownTimer | undefined;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (fallback !== undefined) {
      try {
        cancel(fallback);
      } catch {
        /* shutdown must continue even if a custom timer cannot be cancelled */
      }
    }
    try {
      options.release();
    } finally {
      options.exit(0);
    }
  };

  return (): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    fallback = schedule(finish, timeoutMs);
    fallback.unref?.();
    try {
      options.server.close(() => finish());
    } catch {
      finish();
    }
  };
}
