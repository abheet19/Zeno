/**
 * The copy itself — the only part of ingestion that touches a disk.
 *
 * Everything interesting was decided in `install.ts`, which is pure. This file does
 * what that plan says and nothing more, and its whole discipline is about the two
 * ways copying a stranger's folder goes wrong:
 *
 * A SKILL IS A FOLDER, NOT A FILE. Real skills ship `references/`, scripts, sample
 * documents. Copying only SKILL.md would install a manual whose every cross-reference
 * points at nothing. So the copy is recursive — and therefore has to be bounded.
 *
 * A BOUNDED COPY, BECAUSE THE SOURCE IS UNTRUSTED. Symlinks are skipped rather than
 * followed: a link named `docs` pointing at `C:\Users\me\.ssh` would otherwise be
 * copied into the library, and from there into a prompt. Entry names are checked as
 * single path segments, and every destination path is re-checked against the library
 * root, so a crafted name cannot write outside it. File count, individual file size
 * and total bytes are capped, because "unpack whatever this folder contains" with no
 * ceiling is a way to fill a disk. Every one of those refusals is REPORTED, never
 * silent: a skill installed with half its references missing, and nothing said, is
 * worse than one that failed loudly.
 *
 * The network is not here and must not arrive here. See the seam described at the top
 * of `install.ts`: bytes from off this machine come in through a `net.fetch` capsule
 * the owner approved, which lands them in a directory, and this file starts there.
 */
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { loadLibrary } from './library.js';
import { nodeSkillReader, SKILL_FILE } from './skills-node.js';
import { planInstall, type InstallOptions, type InstallPlan } from './install.js';

/** Caps on one incoming skill folder. Generous for real skills, finite for hostile ones. */
export const MAX_SKILL_FILES = 200;
export const MAX_SKILL_FILE_BYTES = 2_000_000;
export const MAX_SKILL_TOTAL_BYTES = 20_000_000;

export interface IngestResult {
  readonly plan: InstallPlan;
  /** Ids actually written into the library. */
  readonly installed: readonly string[];
  /**
   * What the copy would not do, and why — a skipped symlink, a file over the cap, a
   * folder that could not be read. One line each, in the owner's words.
   */
  readonly skipped: readonly string[];
  /** An id the plan wanted to copy but whose copy failed outright. */
  readonly errors: readonly { readonly id: string; readonly reason: string }[];
}

/** One path segment: no separators, no drive letters, no `.` or `..`. */
function isSafeSegment(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/:]/.test(name);
}

/** `child` really is under `root` after both are resolved. Belt as well as braces. */
function contains(root: string, child: string): boolean {
  const r = resolve(root);
  const c = resolve(child);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

interface CopyBudget {
  files: number;
  bytes: number;
  readonly skipped: string[];
}

/**
 * Copy one skill folder. Depth-first, symlinks skipped, every path re-checked against
 * the destination root. Returns nothing: what happened is recorded in `budget.skipped`,
 * which the caller reports.
 */
function copyTree(from: string, to: string, root: string, budget: CopyBudget, id: string): void {
  let entries: readonly { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[];
  try {
    entries = readdirSync(from, { withFileTypes: true });
  } catch (err) {
    budget.skipped.push(`${id}: could not list ${from} — ${(err as Error).message}`);
    return;
  }
  mkdirSync(to, { recursive: true });
  for (const entry of entries) {
    if (!isSafeSegment(entry.name)) {
      budget.skipped.push(`${id}: skipped an entry whose name is not a plain file name (${JSON.stringify(entry.name)}).`);
      continue;
    }
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (!contains(root, dst)) {
      budget.skipped.push(`${id}: skipped ${entry.name} — it would land outside the skills folder.`);
      continue;
    }
    // `withFileTypes` reports the entry itself, so a symlink is a symlink here and
    // not the thing it points at. Checked again with lstat because a directory entry
    // type can come back UNKNOWN on some filesystems.
    let link = entry.isSymbolicLink();
    try {
      link = link || lstatSync(src).isSymbolicLink();
    } catch {
      /* it vanished between listing and stat; the read below will report it */
    }
    if (link) {
      budget.skipped.push(`${id}: skipped ${entry.name} — it is a symlink, and a skill may not import files from elsewhere on this machine.`);
      continue;
    }
    if (entry.isDirectory()) {
      copyTree(src, dst, root, budget, id);
      continue;
    }
    if (budget.files >= MAX_SKILL_FILES) {
      budget.skipped.push(`${id}: stopped at ${MAX_SKILL_FILES} files — the rest of this folder was not copied.`);
      return;
    }
    let data: Buffer;
    try {
      data = readFileSync(src);
    } catch (err) {
      budget.skipped.push(`${id}: could not read ${entry.name} — ${(err as Error).message}`);
      continue;
    }
    if (data.length > MAX_SKILL_FILE_BYTES) {
      budget.skipped.push(`${id}: skipped ${entry.name} — ${data.length} bytes is over the ${MAX_SKILL_FILE_BYTES}-byte per-file cap.`);
      continue;
    }
    if (budget.bytes + data.length > MAX_SKILL_TOTAL_BYTES) {
      budget.skipped.push(`${id}: stopped at the ${MAX_SKILL_TOTAL_BYTES}-byte total cap — the rest of this folder was not copied.`);
      return;
    }
    writeFileSync(dst, data);
    budget.files += 1;
    budget.bytes += data.length;
  }
}

/**
 * Read a folder of skills as a Library, without installing anything.
 *
 * This is the function to call before showing the owner a plan: it parses and SCREENS
 * every incoming skill, so the findings are on the table before a single byte is
 * copied. A source folder that does not exist reads as an empty library — the same
 * honest answer `nodeSkillReader` gives for a library that was never created.
 */
export function readSkillFolder(dir: string) {
  return loadLibrary(nodeSkillReader(dir));
}

/**
 * Ingest `from` into the library at `into`, applying `planInstall`'s decision.
 *
 * Nothing is copied for a `conflict` or a `reject`: those are the owner's to resolve.
 * The plan is returned in full either way, so a caller can preview by calling this
 * with a plan whose `toCopy` is empty — or, better, call `readSkillFolder` +
 * `planInstall` first and show the owner `describeInstallPlan` before touching disk.
 */
export function ingestSkillFolder(from: string, into: string, opts: InstallOptions = {}): IngestResult {
  const incoming = readSkillFolder(from);
  const installed = loadLibrary(nodeSkillReader(into));
  const plan = planInstall(incoming, installed, opts);

  const budget: CopyBudget = { files: 0, bytes: 0, skipped: [] };
  const done: string[] = [];
  const errors: { id: string; reason: string }[] = [];
  for (const id of plan.toCopy) {
    if (!isSafeSegment(id)) {
      errors.push({ id, reason: 'that id is not a plain folder name, so it was not installed.' });
      continue;
    }
    const dst = join(into, id);
    try {
      mkdirSync(into, { recursive: true });
      copyTree(join(from, id), dst, into, budget, id);
      // The one thing a skill folder is REQUIRED to have. If the caps or a read
      // error swallowed it, the folder now on disk is not a skill, and saying
      // "installed" would be a lie the next `loadLibrary` quietly corrects.
      try {
        readFileSync(join(dst, SKILL_FILE), 'utf8');
      } catch {
        errors.push({ id, reason: `copied, but ${SKILL_FILE} did not arrive — this folder is not a usable skill. Remove it and try again.` });
        continue;
      }
      done.push(id);
    } catch (err) {
      errors.push({ id, reason: (err as Error).message });
    }
  }
  return { plan, installed: done, skipped: budget.skipped, errors };
}
