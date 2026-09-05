#!/usr/bin/env node
/**
 * `zeno-mcp` — wire the pure server to real stdio.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0. So: read lines from stdin,
 * hand each to the codec + dispatcher, write each response to stdout as one line.
 * NOTHING else is allowed on stdout — every log, banner and error goes to stderr
 * — or the pipe the client parses would be corrupted by a stray print.
 *
 * This is the impure edge, and the only one: the clock, ids, the filesystem and
 * the backlog file all live here, so `server.ts` and `rpc.ts` stay pure. It is
 * the production seam used on the pilot, deliberately thin, and it is not covered
 * by the unit tests — everything with logic to test was pushed behind it.
 */
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  Kernel,
  fileHash,
  loadOrCreateSigner, nodeLedgerStore,
  nodeSandboxFs,
  type World,
} from '@abheet19/zeno-kernel';
import { dispatch, parse } from './rpc.js';
import { mcpHandlers, type WorkItem, type WorkSource } from './server.js';

/** stderr only — stdout is the JSON-RPC pipe and must stay clean. */
function log(line: string): void {
  process.stderr.write(line + '\n');
}

/**
 * A minimal append-only backlog on disk: one JSON object per line. It is the
 * impure sibling of the kernel's ledger store, kept deliberately small — the MCP
 * edge only needs to list and add. Ids follow `local:N`, never reused.
 */
function nodeWorkSource(filePath: string): WorkSource {
  const read = (): WorkItem[] => {
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const items: WorkItem[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        const v = JSON.parse(line) as Partial<WorkItem>;
        if (
          typeof v.id === 'string' &&
          typeof v.title === 'string' &&
          typeof v.body === 'string' &&
          typeof v.createdAt === 'string'
        ) {
          items.push({ id: v.id, title: v.title, body: v.body, createdAt: v.createdAt });
        }
      } catch {
        /* a line we cannot read costs one item, never the whole file */
      }
    }
    return items;
  };
  const seqOf = (id: string): number => {
    const m = /^local:(\d+)$/.exec(id);
    return m ? Number(m[1]) : 0;
  };
  return {
    list: () => read(),
    add: ({ title, body }) => {
      const next = read().reduce((max, it) => Math.max(max, seqOf(it.id)), 0) + 1;
      const item: WorkItem = {
        id: `local:${next}`,
        title: title.trim(),
        body,
        createdAt: new Date().toISOString(),
      };
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, JSON.stringify(item) + '\n', 'utf8');
      return item;
    },
  };
}

function main(): void {
  const dir = resolve(process.env['ZENO_DIR'] ?? '.zeno');
  const sandbox = join(dir, 'sandbox');

  const fs = nodeSandboxFs();
  // The world reads a base through the SAME fs the executor writes with, so the
  // compare-and-swap hash is byte-identical to the executor's own base check.
  const world: World = {
    now: () => new Date().toISOString(),
    id: () => randomUUID(),
    readBase: (targetRef) => fileHash(fs.readFile(targetRef)),
    approvalTtlMs: 5 * 60_000,
  };
  const kernel = new Kernel(world, { store: nodeLedgerStore(join(dir, 'ledger.jsonl')), receiptSigner: loadOrCreateSigner(join(dir, 'keys')) });
  const work = nodeWorkSource(join(dir, 'backlog.jsonl'));

  const handlers = mcpHandlers({ kernel, fs, sandbox, work, requestedBy: 'agent' });

  log(`zeno-mcp · workspace ${dir} · ${kernel.receipts().length} receipts · chain ${kernel.verifyChain().ok ? 'verified' : 'BROKEN'}`);
  log('zeno-mcp · propose and read only — there is no approve tool; approval is a human act in the Zeno window.');

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serialize handling so responses leave in request order and never interleave.
  let tail: Promise<void> = Promise.resolve();
  rl.on('line', (line) => {
    tail = tail.then(() => handleLine(handlers, line));
  });
  rl.on('close', () => {
    process.exitCode = 0;
  });
}

async function handleLine(
  handlers: ReturnType<typeof mcpHandlers>,
  line: string,
): Promise<void> {
  if (line.trim() === '') return;
  const parsed = parse(line);
  if (!parsed.ok) {
    write(parsed.error);
    return;
  }
  const response = await dispatch(handlers, parsed.request);
  if (response !== null) write(response);
}

function write(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

main();
