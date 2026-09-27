import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { diffSpecs, type SpecChange } from './diff.js';
import { buildFixPrompt, parseFixResponse, type FixPatch } from './fix.js';
import { applyFixes } from './applyFix.js';
import { loadConfig } from './config.js';
import { loadPreviousSnapshot, loadSnapshot } from './snapshot.js';
import { filterChanges, filterHits, filterTokens, loadIgnore } from './ignore.js';
import { extractTokens, scanRepo, type UsageHit } from './scan.js';
import { dedupePatches } from './verify.js';

export interface FixDeps {
  rootDir: string;
  repoDir: string;
  /** Fixture mode: explicit spec files. Config mode: configPath + snapshot diffing. */
  oldPath?: string;
  newPath?: string;
  configPath?: string;
  apiName: string;
  dryRun: boolean;
  llm: (prompt: string) => Promise<string>;
}

export interface FixResult {
  perChange: {
    change: SpecChange;
    usages: UsageHit[];
    /** Patches unique to this change (duplicates are credited to the first owner). */
    patches: FixPatch[];
    /** Patches this change proposed that another change already covers. */
    duplicates: number;
    error?: string;
  }[];
  /** Deduped, ready to apply. */
  patches: FixPatch[];
  appliedCount: number;
  skippedCount: number;
  errors: string[];
  /** Breaking changes with affected code that produced no usable patch. */
  unresolved: SpecChange[];
}

export async function runFix(deps: FixDeps): Promise<FixResult> {
  let oldSpec: unknown;
  let newSpec: unknown;
  if (deps.oldPath && deps.newPath) {
    oldSpec = JSON.parse(readFileSync(deps.oldPath, 'utf8')) as unknown;
    newSpec = JSON.parse(readFileSync(deps.newPath, 'utf8')) as unknown;
  } else if (deps.configPath) {
    // snapshot mode: diff previous vs current per config entry
    const cfg = loadConfig(deps.configPath);
    const first = cfg.apis[0];
    if (!first) throw new Error('config lists no apis');
    const prev = loadPreviousSnapshot(deps.rootDir, first.name);
    const cur = loadSnapshot(deps.rootDir, first.name);
    if (prev === null || cur === null) {
      throw new Error(`no previous snapshot for ${first.name} — run snapshot twice first`);
    }
    oldSpec = prev;
    newSpec = cur;
  } else {
    throw new Error('fix needs either --old/--new or --config');
  }

  const perChange: FixResult['perChange'] = [];
  const errors: string[] = [];
  const allPatches: FixPatch[] = [];

  const rules = loadIgnore(deps.repoDir);
  for (const change of filterChanges(diffSpecs(oldSpec, newSpec), rules)) {
    const tokens = filterTokens(extractTokens([change]), rules);
    const usages = tokens.length > 0 ? filterHits(scanRepo(deps.repoDir, tokens), rules) : [];
    if (usages.length === 0) continue; // nothing in the repo uses this surface

    const files: Record<string, string> = {};
    for (const u of [...new Set(usages.map((u) => u.file))]) {
      try {
        files[u] = readFileSync(u, 'utf8');
      } catch {
        // unreadable file — skip its content, keep the hit listed
      }
    }

    const prompt = buildFixPrompt({ apiName: deps.apiName, change, usages, files });
    try {
      const raw = await deps.llm(prompt);
      const proposed = parseFixResponse(raw, files)
        // scanner paths are cwd-relative; the applier resolves rootDir-relative — normalize here
        .map((p) => ({ ...p, file: relative(deps.repoDir, resolve(p.file)) }));
      // A model fed several changes often returns the same edit each time. Credit
      // it once, to the change that proposed it first — otherwise a change looks
      // "fixed" by someone else's patch and the exit code lies.
      const fresh = dedupePatches([...allPatches, ...proposed]).slice(allPatches.length);
      perChange.push({ change, usages, patches: fresh, duplicates: proposed.length - fresh.length });
      allPatches.push(...fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      perChange.push({ change, usages, patches: [], duplicates: 0, error: msg.slice(0, 200) });
      errors.push(msg.slice(0, 200));
    }
  }

  const { applied, skipped } = applyFixes(deps.repoDir, allPatches, deps.dryRun);
  const unresolved = perChange.filter((pc) => pc.patches.length === 0 && pc.duplicates === 0).map((pc) => pc.change);
  return {
    perChange,
    patches: allPatches,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    errors,
    unresolved,
  };
}
