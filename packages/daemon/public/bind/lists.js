/**
 * bind/lists.js — Command → Work, Vault, Integrations, Chats, Projects and
 * Customize screens, wired to real daemon data (and, for Chats, to this
 * browser's own archive of the Home conversation).
 *
 * This file is the thin entry point bind.js loads (`import('./bind/lists.js')`
 * then `bind()`); each screen's own binder lives in its own module under
 * bind/lists/, split out because a single ~1,300-line file binding six
 * unrelated screens had stopped being one cohesive thing:
 *   bind/lists/shared.js        format/DOM helpers, POST/DELETE, toast, and
 *                                the connector/extension "facts" shaping
 *                                shared by Integrations and Customize.
 *   bind/lists/mcp.js           createMcpManager — the one GET/POST/DELETE
 *                                /forge/mcp/servers component Integrations
 *                                and Customize both render (as `.lcard` or
 *                                `.lrow`, per `shape`).
 *   bind/lists/work.js          WORK screen.
 *   bind/lists/vault.js         VAULT screen (+ today's brief).
 *   bind/lists/integrations.js  INTEGRATIONS screen.
 *   bind/lists/chats.js         CHATS screen.
 *   bind/lists/projects.js      PROJECTS screen.
 *   bind/lists/customize.js     CUSTOMIZE screen.
 *
 * The artifact (index.html) draws these six screens as:
 *   Work           `.sbar` (search + 4 `.filterpill`s: All/Tickets/Sandbox/
 *                  Sources) above a `.card > .row-list#work-list` of `.lrow`s.
 *   Vault          `.sbar` (search only) above a `#import-card` (the mock
 *                  "import preview") and a second `.card > .row-list` of
 *                  `.lrow`s.
 *   Integrations   a `.live-cards` of `.lcard`s (`.lk`/`.lm`/`.lr`) — NOT the
 *                  `.lrow` shape the other screens use. Sections: work
 *                  sources, agents/local runtime, connectors
 *                  (`GET /forge/connectors`), MCP servers (`GET /forge/mcp
 *                  /servers`, plus a real add-server form — see Customize),
 *                  extensions (`GET /forge/extensions`) and repository
 *                  skills (`GET /skills`). Nothing here is the artifact's
 *                  invented GitHub/Vantage/Chrome-bridge fixture rows —
 *                  those are replaced outright by whatever the daemon
 *                  actually reports, including "nothing configured".
 *   Chats          `.sbar` (search) above `#chats-list-view` (a
 *                  `.row-list#chats-list` of rows) and `#chats-open-view`
 *                  (`#chats-title`, `#chats-turns`, and its own composer:
 *                  `#chats-ta` / `#chats-send` / `#chats-back`).
 *   Projects       a plain `.card > .row-list[data-mount="projects-list"]`.
 *                  This daemon exposes no endpoint that lists more than one
 *                  project — only `GET /forge/status`, which reports the one
 *                  sandbox repo Forge actually operates in. That single repo
 *                  is drawn as one row; the absence of a real multi-project
 *                  endpoint is stated plainly rather than papered over with
 *                  invented rows.
 *   Customize      a plain `.card > .row-list[data-mount="customize-list"]`.
 *                  Real, every row: MCP servers (`GET`/`POST`/`DELETE
 *                  /forge/mcp/servers`, add/remove owner-only), installed
 *                  skills (`GET /skills`), connectors (`GET
 *                  /forge/connectors` — Zeno's own bundled, run-scoped
 *                  bridges; NOT a third-party-account catalog, because this
 *                  daemon has none) and extensions (`GET /forge/extensions`
 *                  — built-ins, skill provenance and editor snippets). The
 *                  artifact's old top-level `public/customize.js` invented a
 *                  Google-Drive/Slack/Notion connector catalog and an
 *                  Anthropic-plugin catalog that exist nowhere in this
 *                  daemon; that file is not even loaded any more (bind.js's
 *                  BINDERS list only loads this one) and this binder never
 *                  reintroduces its fixtures.
 *
 * ui.js already wires generic chrome that is safe to leave alone: filterpill
 * `aria-current` highlighting, `[data-product-go]` (the real Command<->Forge
 * switch), `[data-screen-jump]` (the real screen switch — Work's "+ New task"
 * already does the right thing by jumping to Home), `[data-import]` /
 * `[data-import-cancel]` (show/hide `#import-card`), and `#chats-back`'s
 * view toggle. None of that is touched here. What ui.js also ships, and this
 * file replaces, is invented content: three demo `CHATS` conversations, a
 * canned `zenoReply()` for every composer, and the mock rows already sitting
 * in `#work-list`, the Vault notes card, `#import-card` and `.live-cards`.
 *
 * Screen lookup always goes through bind.js's `screenEl()`, never a bare
 * `[data-screen="…"]` — the left rail's nav button carries the same
 * attribute and sits earlier in the document, so a bare query would find the
 * button, not the section.
 *
 * Endpoints, confirmed against packages/daemon/src/server.ts and the ports
 * behind them (work.ts's WorkItem/SourceReport, vault/note.ts's Note,
 * memory-routes.ts's pending queue):
 *   GET  /work            -> { items: WorkItem[], sources: SourceReport[] }
 *   GET  /forge/status     -> { repo:false, note } | { repo:true, branch, head,
 *                              changed:[{status,path}], log, trackedTotal, … }
 *   GET  /forge/agents     -> { agents:[{id,label,available,…}], localModels }
 *   GET  /skills           -> { skills:[{id,name,description,bytes,verdict}], failed }
 *   GET  /memory           -> { notes: Note[] } | 404 { error:{code:'no-vault'} }
 *   GET  /memory?q=…       -> { query, hits:[{note,score,matched}] }
 *   GET  /memory/pending   -> { pending:[{preview:{actionHash,tier},payload}] }
 *   POST /memory/approvals -> { actionHash } -> { approval, receipt, entry }
 *   GET  /brief            -> { brief:{status,at,sources:[{name,items}],missing} }
 *   POST /assistant/ask    -> { question } -> { answer } | { flagged } | { note } | { error }
 *   GET    /forge/mcp/servers    -> { servers:[{id,name,transport,command,args,url,envKeys}] }
 *   POST   /forge/mcp/servers    -> { name,transport,command,args,url,env } -> { server } (owner-only)
 *   DELETE /forge/mcp/servers/<id> -> { id, deleted } (owner-only)
 *   GET    /forge/connectors     -> { mode, ambientExternalServersLoaded, servers:[{id,name,
 *                                     configured,activeRuns,tools,provenance,permissions,
 *                                     attached?,allowedOrigins?}], external:[], note }
 *   GET    /forge/extensions     -> { compatibility, builtins:[{id,name,kind,status,
 *                                     provenance,permissions,variants?}], skills:[…same shape
 *                                     as skillCatalog entries…], skillSources:[{path,
 *                                     provenance,installed,unreadable,reason?}],
 *                                     snippets:[{file,provenance,entries,status,reason?,
 *                                     enabledInMonaco}], note }
 *
 * A WorkItem carries NO tier/status field (packages/intake/src/work-item.ts),
 * so ticket rows never claim a "T2 · owner: you" the mock invented — only
 * id, title, source, age and labels, all real.
 *
 * Chats stores its archive in `localStorage['zeno-chats']` — the same key
 * bind.js's rail-badge counter already reads (`Array.isArray(arr).length`),
 * so the two agree without either reaching into the other. Turns are
 * snapshotted from Home's own live thread (`#home-turns .turn.you|.z .bt`,
 * ui.js's own markup) rather than invented, and the composer inside an
 * opened chat calls the same real `/assistant/ask` Home uses (see ask.js) —
 * never a canned reply.
 */

import { bindWork } from './lists/work.js';
import { bindVault } from './lists/vault.js';
import { bindIntegrations } from './lists/integrations.js';
import { bindChats } from './lists/chats.js';
import { bindProjects } from './lists/projects.js';
import { bindCustomize } from './lists/customize.js';

/* ---------------------------------------------------------------------- *
 * the seam bind.js calls. Each screen binds independently and never lets a
 * failure in one blank the others.
 * ---------------------------------------------------------------------- */
export async function bind() {
  await Promise.allSettled([
    bindWork().catch((err) => console.warn('[zeno] lists: work bind failed', err)),
    bindVault().catch((err) => console.warn('[zeno] lists: vault bind failed', err)),
    bindIntegrations().catch((err) => console.warn('[zeno] lists: integrations bind failed', err)),
    bindChats().catch((err) => console.warn('[zeno] lists: chats bind failed', err)),
    bindProjects().catch((err) => console.warn('[zeno] lists: projects bind failed', err)),
    bindCustomize().catch((err) => console.warn('[zeno] lists: customize bind failed', err)),
  ]);
}
