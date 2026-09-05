/**
 * The one-way push channel: Server-Sent Events.
 *
 * SSE rather than a WebSocket because this direction is genuinely one-way — the
 * server tells the browser that a preview arrived or a receipt landed, and the
 * browser never pushes back over the same channel (approving is a POST, because
 * an approval must be an explicit, auditable request). SSE also gives us
 * `Last-Event-ID` reconnection for free, which is the part that matters here.
 *
 * The honest bit: the replay buffer is bounded. When a client is away long
 * enough that its gap has fallen out of the buffer, we say so with an explicit
 * `gap` event rather than silently stitching the stream back together. A UI
 * that quietly resumes is claiming a completeness it does not have.
 */

export interface StreamEvent {
  readonly id: number;
  readonly event: string;
  readonly data: unknown;
}

/** Anything that can receive a frame. `http.ServerResponse` satisfies this. */
export interface SseSink {
  write(chunk: string): unknown;
}

export function frame(e: StreamEvent): string {
  // `data` must be a single line; JSON.stringify never emits a raw newline.
  return `id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export class Stream {
  private seq = 0;
  private readonly buffer: StreamEvent[] = [];
  private readonly clients = new Set<SseSink>();

  constructor(private readonly keep = 500) {}

  /** Broadcast an event and remember it for reconnecting clients. */
  publish(event: string, data: unknown): StreamEvent {
    const e: StreamEvent = { id: ++this.seq, event, data };
    this.buffer.push(e);
    while (this.buffer.length > this.keep) this.buffer.shift();
    const text = frame(e);
    for (const c of this.clients) {
      try {
        c.write(text);
      } catch {
        // A dead socket must never stop the others from being told.
        this.clients.delete(c);
      }
    }
    return e;
  }

  /**
   * Events after `lastId`, or `null` when that gap can no longer be replayed.
   * `null` is not an error — it is the truth, and the caller must tell the user.
   */
  replay(lastId: number): StreamEvent[] | null {
    if (lastId >= this.seq) return [];
    const oldest = this.buffer[0];
    if (oldest === undefined) return [];
    if (lastId + 1 < oldest.id) return null; // it fell out of the buffer
    return this.buffer.filter((e) => e.id > lastId);
  }

  /**
   * Attach a client, replaying what it missed. Returns the frames to send
   * immediately — including a `gap` event when the history is no longer complete.
   */
  attach(sink: SseSink, lastEventId: number | null): string {
    this.clients.add(sink);
    let out = 'retry: 2000\n\n';
    if (lastEventId === null) return out;
    const missed = this.replay(lastEventId);
    if (missed === null) {
      out += frame({
        id: this.seq,
        event: 'gap',
        data: {
          message: 'Some events happened while this page was disconnected and can no longer be replayed.',
          resolve: 'Reload to re-read the full state from the ledger.',
          lastEventId,
          currentId: this.seq,
        },
      });
      return out;
    }
    for (const e of missed) out += frame(e);
    return out;
  }

  detach(sink: SseSink): void {
    this.clients.delete(sink);
  }

  clientCount(): number {
    return this.clients.size;
  }

  lastId(): number {
    return this.seq;
  }
}
