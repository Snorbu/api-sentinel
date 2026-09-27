/**
 * Apply patches, then prove the repo still builds — and undo everything if it
 * doesn't.
 *
 * This is what separates "suggests fixes" from "fixes". A model patch that
 * parses and matches verbatim can still be wrong; the only honest signal is
 * the consumer's own build/test command. We snapshot every file we are about
 * to touch, apply, run the command, and on failure restore byte-for-byte.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { applyFixesDetailed, type ApplyResult } from './applyFix.js';
import type { FixPatch } from './fix.js';

export interface VerifyOutcome {
  ok: boolean;
  exitCode: number;
  output: string;
}

export interface VerifiedApplyResult extends ApplyResult {
  verified?: VerifyOutcome;
  /** True when the verify command failed and every file was restored. */
  rolledBack: boolean;
}

export const VERIFY_TIMEOUT_MS = 10 * 60_000;

/** Run a shell command in `cwd`, capturing a bounded slice of its output. */
export function runVerify(cwd: string, command: string, timeout = VERIFY_TIMEOUT_MS): VerifyOutcome {
  const res = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().slice(-4000);
  if (res.error !== undefined) {
    return { ok: false, exitCode: -1, output: `${res.error.message}\n${output}`.trim() };
  }
  const exitCode = res.status ?? -1;
  return { ok: exitCode === 0, exitCode, output };
}

function absolutePath(rootDir: string, file: string): string {
  return isAbsolute(file) ? file : join(resolve(rootDir), file);
}

/**
 * Apply `patches` under `rootDir`; if `verifyCommand` is given, run it and roll
 * every touched file back when it fails. Returns what was applied, the verify
 * outcome, and whether a rollback happened.
 */
export function applyFixesVerified(
  rootDir: string,
  patches: FixPatch[],
  opts: { verifyCommand?: string; timeout?: number } = {},
): VerifiedApplyResult {
  const backups = new Map<string, string | null>();
  if (opts.verifyCommand !== undefined) {
    for (const p of patches) {
      const abs = absolutePath(rootDir, p.file);
      if (backups.has(abs)) continue;
      try {
        backups.set(abs, readFileSync(abs, 'utf8'));
      } catch {
        backups.set(abs, null); // unreadable/missing — the applier will skip it anyway
      }
    }
  }

  const result = applyFixesDetailed(rootDir, patches, false);
  if (opts.verifyCommand === undefined) return { ...result, rolledBack: false };

  const verified = runVerify(rootDir, opts.verifyCommand, opts.timeout);
  if (verified.ok) return { ...result, verified, rolledBack: false };

  for (const [abs, original] of backups) {
    if (original === null) continue;
    try {
      writeFileSync(abs, original);
    } catch {
      // best effort: a file we cannot restore is reported via rolledBack
    }
  }
  return { applied: [], skipped: [...result.applied, ...result.skipped], verified, rolledBack: true };
}

/** Drop patches that are byte-identical to one already kept (same file/find/replace). */
export function dedupePatches<T extends FixPatch>(patches: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of patches) {
    const key = `${p.file}\u0000${p.find}\u0000${p.replace}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
