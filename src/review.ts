import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyFixes } from './applyFix.js';
import type { FixPatch } from './fix.js';

export type Decision = 'yes' | 'no' | 'all';

export interface ReviewDeps {
  /** Prompt with a rendered diff and return the raw answer: 'y' | 'n' | 'a' (default: skip). */
  ask: (question: string) => Promise<string>;
}

export interface ReviewResult {
  applied: string[];
  decisions: { patch: FixPatch; decision: 'apply' | 'skip' }[];
}

function renderDiff(patch: FixPatch, fileContent: string): string {
  const idx = fileContent.indexOf(patch.find);
  const before = idx > 40 ? '…' + fileContent.slice(idx - 40, idx) : fileContent.slice(0, idx);
  const afterIdx = idx + patch.find.length;
  const after = fileContent.slice(afterIdx, afterIdx + 40) + (fileContent.length > afterIdx + 40 ? '…' : '');
  const lines: string[] = [];
  lines.push(`patch for ${patch.file} — ${patch.explanation}`);
  lines.push(`${before}${patch.find}${after}`.split('\n').map((l) => `  ${l}`).join('\n'));
  lines.push(`- ${patch.find.split('\n').join('\n- ')}`);
  lines.push(`+ ${patch.replace.split('\n').join('\n+ ')}`);
  lines.push('apply this patch? [y]es / [n]o / [a]ll (default: n)');
  return lines.join('\n');
}

/**
 * Interactive per-patch review: each patch is shown as a before/after diff and
 * the developer decides. 'a' accepts this patch and all remaining ones without
 * asking again. Anything but y/n/a (or EOF) skips — safe default.
 */
export async function reviewPatches(
  rootDir: string,
  patches: FixPatch[],
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const applied: string[] = [];
  const decisions: ReviewResult['decisions'] = [];
  let acceptAll = false;

  for (const patch of patches) {
    let decision: 'apply' | 'skip' = 'skip';
    if (acceptAll) {
      decision = 'apply';
    } else {
      let content = '';
      try {
        content = readFileSync(join(rootDir, patch.file), 'utf8');
      } catch {
        decisions.push({ patch, decision: 'skip' });
        continue;
      }
      const answer = (await deps.ask(renderDiff(patch, content))).trim().toLowerCase();
      if (answer === 'a') {
        acceptAll = true;
        decision = 'apply';
      } else if (answer === 'y') {
        decision = 'apply';
      } // anything else: skip
    }
    decisions.push({ patch, decision });
    if (decision === 'apply') applied.push(patch.file);
  }

  const toWrite = patches.filter((_, i) => decisions[i]?.decision === 'apply');
  applyFixes(rootDir, toWrite, false);
  return { applied, decisions };
}
