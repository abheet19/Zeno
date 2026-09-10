import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDaemonShutdown,
  installBeforeServerClose,
  removeWorkspaceLockIfOwned,
  type CloseableServer,
  type ShutdownTimer,
} from '../src/lifecycle.js';

test('workspace cleanup never unlinks a successor claim', () => {
  let current = 'new-owner-claim';
  let unlinks = 0;
  const io = {
    read: () => current,
    unlink: () => {
      unlinks++;
      current = '';
    },
  };

  assert.equal(removeWorkspaceLockIfOwned('zeno.lock', 'stale-owner-claim', io), false);
  assert.equal(current, 'new-owner-claim');
  assert.equal(unlinks, 0, 'a stale reader cannot remove the lock that replaced its observation');

  assert.equal(removeWorkspaceLockIfOwned('zeno.lock', 'new-owner-claim', io), true);
  assert.equal(unlinks, 1, 'the exact owner claim is removed once');
  assert.equal(removeWorkspaceLockIfOwned('zeno.lock', 'new-owner-claim', io), false);
  assert.equal(unlinks, 1, 'repeated cleanup is harmless');
});
test('server close aborts active work before it starts waiting for requests', () => {
  const events: string[] = [];
  const server: CloseableServer = {
    close(callback?: (error?: Error) => void): CloseableServer {
      events.push('native-close');
      callback?.();
      return this;
    },
  };

  installBeforeServerClose(server, () => events.push('abort-runs'));
  server.close(() => events.push('closed'));
  server.close(() => events.push('closed-again'));

  assert.deepEqual(events, ['abort-runs', 'native-close', 'closed', 'native-close', 'closed-again']);
});

test('signal shutdown closes once, releases once, and cancels its fallback after draining', () => {
  const events: string[] = [];
  let closeCallback: ((error?: Error) => void) | undefined;
  let fallbackCallback: (() => void) | undefined;
  const timer: ShutdownTimer = { unref: () => events.push('unref') };
  const server: CloseableServer = {
    close(callback?: (error?: Error) => void): CloseableServer {
      events.push('close');
      closeCallback = callback;
      return this;
    },
  };
  const shutdown = createDaemonShutdown({
    server,
    release: () => events.push('release'),
    exit: (code) => events.push(`exit:${code}`),
    schedule: (callback, timeoutMs) => {
      events.push(`schedule:${timeoutMs}`);
      fallbackCallback = callback;
      return timer;
    },
    cancel: (handle) => {
      assert.equal(handle, timer);
      events.push('cancel');
    },
  });

  shutdown();
  shutdown();
  assert.deepEqual(events, ['schedule:3000', 'unref', 'close']);

  assert.ok(closeCallback);
  closeCallback();
  assert.deepEqual(events, ['schedule:3000', 'unref', 'close', 'cancel', 'release', 'exit:0']);

  assert.ok(fallbackCallback);
  fallbackCallback();
  assert.deepEqual(events, ['schedule:3000', 'unref', 'close', 'cancel', 'release', 'exit:0']);
});

test('signal shutdown has a bounded fallback when open connections never drain', () => {
  const events: string[] = [];
  let fallbackCallback: (() => void) | undefined;
  const server: CloseableServer = {
    close(): CloseableServer {
      events.push('close-pending');
      return this;
    },
  };
  const shutdown = createDaemonShutdown({
    server,
    release: () => events.push('release'),
    exit: (code) => events.push(`exit:${code}`),
    timeoutMs: 25,
    schedule: (callback, timeoutMs) => {
      events.push(`schedule:${timeoutMs}`);
      fallbackCallback = callback;
      return {};
    },
    cancel: () => events.push('cancel'),
  });

  shutdown();
  assert.deepEqual(events, ['schedule:25', 'close-pending']);

  assert.ok(fallbackCallback);
  fallbackCallback();
  assert.deepEqual(events, ['schedule:25', 'close-pending', 'cancel', 'release', 'exit:0']);
});
