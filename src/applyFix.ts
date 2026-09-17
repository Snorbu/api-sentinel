import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { FixPatch } from './fix.js';

export interface ApplyResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply patches to files under rootDir. Every patch is re-verified at apply
 * time (TOCTOU-safe): the target must exist, stay inside rootDir, and still
 * contain `find` verbatim. Dry-run reports would-apply without writing.
 */
export function applyFixes(rootDir: string, patches: FixPatch[], dryRun: boolean): ApplyResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  const rootResolved = resolve(rootDir);

  for (const p of patches) {
    const abs = isAbsolute(p.file) ? p.file : join(rootResolved, p.file);
    const jailed = resolve(abs).startsWith(rootResolved + sep) || resolve(abs) === rootResolved;
    if (!jailed) {
      skipped.push(p.file);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      skipped.push(p.file); // missing file — never create it
      continue;
    }
    const idx = content.indexOf(p.find);
    if (idx === -1) {
      skipped.push(p.file); // find vanished or never existed — TOCTOU gate
      continue;
    }
    if (dryRun) {
      applied.push(p.file);
      continue;
    }
    const next = content.slice(0, idx) + p.replace + content.slice(idx + p.find.length);
    writeFileSync(abs, next);
    applied.push(p.file);
  }
  return { applied, skipped };
}
