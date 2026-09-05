/**
 * `zeno propose` — ask the daemon to do something, as an agent would.
 *
 * This exists to be run in a SECOND terminal while the Zeno window is open, so
 * you can watch a proposal arrive live and then approve it with a click. It
 * carries the PROPOSER token deliberately: try pointing it at /approvals and it
 * is refused, which is the whole argument of the product in one command.
 */
export interface ProposeOptions {
  readonly url: string;
  readonly token: string;
  readonly relPath: string;
  readonly contents: string;
  readonly summary: string;
  readonly kind?: string;
  readonly requestedBy?: string;
  readonly log: (line: string) => void;
}

export interface ProposeResult {
  readonly status: number;
  readonly body: unknown;
}

export async function propose(o: ProposeOptions): Promise<ProposeResult> {
  const endpoint = `${o.url.replace(/\/$/, '')}/previews`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': o.token },
      body: JSON.stringify({
        relPath: o.relPath,
        contents: o.contents,
        summary: o.summary,
        ...(o.kind === undefined ? {} : { kind: o.kind }),
        ...(o.requestedBy === undefined ? {} : { requestedBy: o.requestedBy }),
      }),
    });
  } catch (err) {
    // A daemon that is not there used to surface as a bare `TypeError: fetch
    // failed` from the top-level handler — no address, no hint that the CLI had
    // chosen the address itself from ZENO_PORT. The one fact the owner needs is
    // WHERE this went, because a wrong port is the likeliest cause and is
    // invisible otherwise.
    o.log('');
    o.log(`  NOT SENT — nothing reached a daemon at ${endpoint}`);
    o.log(`     ${err instanceof Error ? err.message : String(err)}`);
    o.log('     Is a Zeno running there? Set --url, or ZENO_PORT to the port it announced.');
    o.log('');
    return { status: 0, body: null };
  }
  const body: unknown = await res.json().catch(() => ({}));
  render(res.status, body, o.log);
  return { status: res.status, body };
}

/** Prove the boundary: the same token, pointed at the approval route. */
export async function proveCannotApprove(
  url: string,
  token: string,
  actionHash: string,
  log: (l: string) => void,
): Promise<number> {
  const res = await fetch(`${url.replace(/\/$/, '')}/approvals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zeno-token': token },
    body: JSON.stringify({ actionHash }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; resolve?: string } };
  log('');
  log(`  the same token, pointed at /approvals  ->  HTTP ${res.status}`);
  if (body.error?.message !== undefined) log(`     ${body.error.message}`);
  if (body.error?.resolve !== undefined) log(`     ${body.error.resolve}`);
  return res.status;
}

function render(status: number, body: unknown, log: (l: string) => void): void {
  const b = body as {
    preview?: { actionHash: string; tier: string; summary: string; reasons: string[]; auto: boolean };
    receipt?: { outcome: string; selfHash: string };
    risk?: { routine: boolean; reasons: string[] };
    error?: { code: string; message: string; resolve: string };
  };
  log('');
  if (status === 200 && b.preview !== undefined) {
    const p = b.preview;
    // A routine action has ALREADY happened by the time this returns. Saying
    // "nothing has happened yet" here would be the one kind of lie this product
    // exists to prevent.
    const applied = b.receipt !== undefined;
    log(applied ? '  APPLIED — routine, so it did not interrupt you.' : '  PROPOSED — and nothing has happened yet.');
    log(`     summary   ${p.summary}`);
    log(`     tier      ${p.tier}   ${p.reasons.join(' · ')}`);
    if (b.risk !== undefined) log(`     why        ${b.risk.reasons.join(' · ')}`);
    log(`     action    ${p.actionHash.slice(0, 16)}…`);
    if (applied) {
      log(`     outcome   ${b.receipt!.outcome.toUpperCase()}   receipt ${b.receipt!.selfHash.slice(0, 12)}…`);
      log('');
      log('  It is on disk, and in the ledger. Nothing was hidden — run: npm run ledger:verify');
    } else {
      log(`     needs     the owner, in the Zeno window`);
      log('');
      log('  Look at the Zeno window: the capsule is waiting. Nothing has been written.');
    }
    return;
  }
  log(`  REFUSED — HTTP ${status}`);
  if (b.error !== undefined) {
    log(`     ${b.error.code}: ${b.error.message}`);
    log(`     fix: ${b.error.resolve}`);
  }
  log('');
}
