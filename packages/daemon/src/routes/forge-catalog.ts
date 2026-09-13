/**
 * Forge's local capability catalog: installed VS Code snippets (catalogued,
 * never executed), Agent Skills (repository and global, with provenance and a
 * screening verdict), and the bundled MCP-shaped servers this daemon can admit
 * into a governed run.
 */
import { homedir } from 'node:os';
import { opendirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import { loadLibrary, nodeSkillReader } from '@abheet19/zeno-skills';
import { readOriginPolicy } from '@abheet19/zeno-chrome';
import {
  BROWSE_METHODS,
  BROWSE_SERVER,
  CHROME_METHODS,
  CHROME_SERVER,
  GATE_METHOD,
  GATE_SERVER,
} from '@abheet19/zeno-forge';
import type { ServerCtx } from '../server/context.js';
import { json } from './http.js';
import { readUtf8Bounded } from './forge-text.js';

/** Parse installed snippet manifests as catalog facts; never execute them. */
function snippetCatalog(ctx: ServerCtx): readonly Record<string, unknown>[] {
  const appData = process.env['APPDATA'];
  const roots = [
    { dir: join(ctx.opts.sandbox, '.vscode'), provenance: 'repository' },
    ...(appData ? [{ dir: join(appData, 'Code', 'User', 'snippets'), provenance: 'VS Code user profile' }] : []),
  ];
  const snippets: Record<string, unknown>[] = [];
  for (const source of roots) {
    let handle: ReturnType<typeof opendirSync> | undefined;
    try {
      handle = opendirSync(source.dir);
      let scanned = 0;
      for (let item = handle.readSync(); item !== null && scanned < 256; item = handle.readSync()) {
        scanned++;
        if (!item.isFile() || !item.name.endsWith('.code-snippets')) continue;
        try {
          const parsed = JSON.parse(readUtf8Bounded(join(source.dir, item.name), 128_000).text) as unknown;
          const count = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).length : 0;
          snippets.push({ file: item.name, provenance: source.provenance, entries: count, status: 'catalogued', enabledInMonaco: false });
        } catch (err) {
          snippets.push({ file: item.name, provenance: source.provenance, entries: 0, status: 'unreadable', reason: (err as Error).message, enabledInMonaco: false });
        }
      }
    } catch {
      /* A missing snippets directory is an accurate empty source. */
    } finally {
      try { handle?.closeSync(); } catch { /* keep the original result */ }
    }
  }
  return snippets;
}

function skillCatalog(ctx: ServerCtx): { readonly sources: readonly Record<string, unknown>[]; readonly entries: readonly Record<string, unknown>[] } {
  const home = homedir();
  const candidates = [
    { dir: join(ctx.opts.sandbox, '.agents', 'skills'), provenance: 'selected repository', selectable: true },
    { dir: join(home, '.agents', 'skills'), provenance: 'global Agent Skills', selectable: false },
    { dir: join(home, '.codex', 'skills'), provenance: 'global Codex skills', selectable: false },
    { dir: join(home, '.cursor', 'skills'), provenance: 'global Cursor skills', selectable: false },
  ];
  const seen = new Set<string>();
  const sources: Record<string, unknown>[] = [];
  const entries: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const key = resolve(candidate.dir).toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const lib = loadLibrary(nodeSkillReader(candidate.dir));
      sources.push({ path: candidate.dir, provenance: candidate.provenance, installed: lib.skills.length, unreadable: lib.failed.length });
      for (const skill of lib.skills) {
        entries.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          kind: 'agent-skill',
          provenance: candidate.provenance,
          sourcePath: candidate.dir,
          selectableInThisRepository: candidate.selectable,
          verdict: skill.screen.verdict,
          findings: skill.screen.findings.length,
          permissions: ['prompt context only'],
          authority: 'none — every tool call and file effect keeps its existing Zeno gate',
        });
      }
      for (const failed of lib.failed) {
        entries.push({ id: failed.id, name: failed.id, kind: 'agent-skill', provenance: candidate.provenance, sourcePath: candidate.dir, status: 'unreadable', reason: failed.reason, selectableInThisRepository: false, permissions: [] });
      }
    } catch (err) {
      sources.push({ path: candidate.dir, provenance: candidate.provenance, installed: 0, unreadable: 1, reason: (err as Error).message });
    }
  }
  return { sources, entries: entries.slice(0, 512) };
}

export function serveForgeExtensions(ctx: ServerCtx, res: ServerResponse): void {
  const skills = skillCatalog(ctx);
  json(res, 200, {
    compatibility: { vscodeMarketplace: false, externalExtensionHost: false, format: 'Zeno capability catalog v1' },
    builtins: [
      { id: 'monaco-editor', name: 'Monaco editor core', kind: 'editor', status: 'enabled', provenance: 'bundled with Zeno', permissions: ['read selected repository files', 'edit in memory; saves become Zeno proposals'] },
      { id: 'glass-themes', name: 'Glass themes', kind: 'theme', status: 'enabled', provenance: 'Zeno design system', variants: ['System', 'Graphite', 'Glass Dawn'], permissions: [] },
      { id: 'rainbow-brackets', name: 'Rainbow brackets', kind: 'editor-setting', status: 'enabled', provenance: 'Monaco bracket pair colorization', permissions: [] },
    ],
    skills: skills.entries,
    skillSources: skills.sources,
    snippets: snippetCatalog(ctx),
    note: 'This is Zeno’s local capability catalog. It does not claim VS Code Marketplace or VSIX compatibility. Global skills are visible with provenance; only skills installed in the selected repository are selectable for a run.',
  });
}

export function serveForgeConnectors(ctx: ServerCtx, res: ServerResponse): void {
  let allowlistCount = 0;
  try { allowlistCount = readOriginPolicy(ctx.chromeOriginsPath).allowed.length; } catch { /* unreadable means no claimed origins */ }
  json(res, 200, {
    mode: 'strict, run-scoped Zeno MCP config',
    ambientExternalServersLoaded: false,
    servers: [
      {
        id: GATE_SERVER,
        name: 'Zeno permission gate',
        configured: ctx.opts.forgeShell !== false,
        activeRuns: ctx.gateRuns.size,
        tools: [GATE_METHOD],
        provenance: '@abheet19/zeno-forge (bundled)',
        permissions: 'The model cannot call this tool. Claude Code’s permission bridge uses it to turn escaping calls into owner approval capsules.',
      },
      {
        id: BROWSE_SERVER,
        name: 'Zeno isolated browser',
        configured: ctx.opts.forgeShell !== false && ctx.opts.forgeNetwork === true && ctx.opts.forgeBrowser !== false,
        activeRuns: ctx.browseRuns.size,
        tools: BROWSE_METHODS,
        provenance: '@abheet19/zeno-browse (bundled)',
        permissions: 'Created and proved separately for each eligible Claude Code run; every navigate, read, screenshot, click, and type call is governed.',
      },
      {
        id: CHROME_SERVER,
        name: 'Owner Chrome bridge',
        configured: ctx.opts.forgeShell !== false && ctx.opts.forgeChrome === true,
        attached: ctx.opts.forgeChrome === true && ctx.chrome.attached(),
        allowedOrigins: allowlistCount,
        activeRuns: ctx.chromeRuns.size,
        tools: CHROME_METHODS,
        provenance: '@abheet19/zeno-chrome + owner-installed MV3 bridge',
        permissions: 'Off by default. Requires the environment switch, a live extension proof, an owner origin allowlist, the never-list, and approval for every operation.',
      },
    ],
    external: [],
    note: 'Forge deliberately ignores ambient MCP configuration. Only the bundled servers named here can enter a governed Claude Code run, and only when their configured and liveness conditions hold.',
  });
}
