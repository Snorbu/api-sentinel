import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { classify } from './classify.js';
import { diffSpecs, type SpecChange } from './diff.js';
import { buildFixPrompt, parseFixResponse, type FixPatch } from './fix.js';
import { applyFixes } from './applyFix.js';
import { extractTokens, scanRepo, type UsageHit } from './scan.js';

export interface FixDeps {
  rootDir: string;
  repoDir: string;
  oldPath: string;
  newPath: string;
  apiName: string;
  dryRun: boolean;
  llm: (prompt: string) => Promise<string>;
}

export interface FixResult {
  perChange: {
    change: SpecChange;
    usages: UsageHit[];
    patches: FixPatch[];
    error?: string;
  }[];
  appliedCount: number;
  skippedCount: number;
  errors: string[];
}

export async function runFix(deps: FixDeps): Promise<FixResult> {
  void deps.rootDir; // snapshots unused in fixture mode; kept for future config-mode support
  const oldSpec = JSON.parse(readFileSync(deps.oldPath, 'utf8')) as unknown;
  const newSpec = JSON.parse(readFileSync(deps.newPath, 'utf8')) as unknown;
  const changes = diffSpecs(oldSpec, newSpec).filter((c) => classify(c) === 'breaking');

  const perChange: FixResult['perChange'] = [];
  const errors: string[] = [];
  const allPatches: FixPatch[] = [];

  for (const change of changes) {
    const tokens = extractTokens([change]);
    const usages = tokens.length > 0 ? scanRepo(deps.repoDir, tokens) : [];
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
      const patches = parseFixResponse(raw, files)
        // scanner paths are cwd-relative; the applier resolves rootDir-relative — normalize here
        .map((p) => ({ ...p, file: relative(deps.repoDir, resolve(p.file)) }));
      perChange.push({ change, usages, patches });
      allPatches.push(...patches);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      perChange.push({ change, usages, patches: [], error: msg.slice(0, 200) });
      errors.push(msg.slice(0, 200));
    }
  }

  const { applied, skipped } = applyFixes(deps.repoDir, allPatches, deps.dryRun);
  return { perChange, appliedCount: applied.length, skippedCount: skipped.length, errors };
}
