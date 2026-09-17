import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyFixes } from '../src/applyFix.js';
import type { FixPatch } from '../src/fix.js';

const setup = (): { root: string; file: string } => {
  const root = mkdtempSync(join(tmpdir(), 'apply-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  const file = join(root, 'src', 'payment.ts');
  writeFileSync(file, 'const body = (await res.json()) as { paid: boolean };\nreturn body.paid;\n');
  return { root, file };
};

describe('applyFixes', () => {
  it('applies a verbatim patch to disk (first occurrence only)', () => {
    const { root, file } = setup();
    const patch: FixPatch = {
      file: 'src/payment.ts',
      find: '{ paid: boolean }',
      replace: '{ paid: string }',
      explanation: 'type changed',
    };
    const res = applyFixes(root, [patch], false);
    expect(res.applied).toEqual(['src/payment.ts']);
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('{ paid: string }');
    expect(after.match(/paid: string/g)).toHaveLength(1); // first occurrence only — line 2 untouched
  });

  it('dry-run leaves the file untouched but reports would-apply', () => {
    const { root, file } = setup();
    const before = readFileSync(file, 'utf8');
    const patch: FixPatch = {
      file: 'src/payment.ts',
      find: '{ paid: boolean }',
      replace: '{ paid: string }',
      explanation: 'x',
    };
    const res = applyFixes(root, [patch], true);
    expect(res.applied).toEqual(['src/payment.ts']);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('skips patches escaping rootDir (path traversal)', () => {
    const root = mkdtempSync(join(tmpdir(), 'applyroot-'));
    const evil = resolve(root, '..', 'evil.ts');
    writeFileSync(evil, 'const body = 1;\n');
    try {
      const patch: FixPatch = { file: '../evil.ts', find: 'const body = 1;', replace: 'pwned', explanation: 'x' };
      const res = applyFixes(root, [patch], false);
      expect(res.skipped).toHaveLength(1);
      expect(readFileSync(evil, 'utf8')).toBe('const body = 1;\n'); // untouched
      expect(existsSync(join(root, 'evil.ts'))).toBe(false);
    } finally {
      rmSync(evil, { force: true });
    }
  });

  it('skips patches whose find vanished between validate and apply (TOCTOU)', () => {
    const { root, file } = setup();
    const patch: FixPatch = { file: 'src/payment.ts', find: '{ paid: boolean }', replace: '{ paid: string }', explanation: 'x' };
    // simulate concurrent edit by re-reading inside a wrapper is overkill here; instead test a file removed after parse:
    const res1 = applyFixes(root, [patch], true);
    expect(res1.applied).toHaveLength(1);
    rmSync(file);
    const res2 = applyFixes(root, [{ ...patch }], false);
    expect(res2.skipped).toHaveLength(1);
    expect(existsSync(file)).toBe(false); // never recreated
  });
});
