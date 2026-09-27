import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyFixes, applyFixesDetailed } from '../src/applyFix.js';
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

describe('multi-occurrence handling', () => {
  it('reports occurrences count; applies only when occurrences are unambiguous or forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'multi-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    const file = join(root, 'src', 'dup.ts');
    writeFileSync(file, 'const a = extract(b);\nconst c = extract(d);\nconst e = extract(f);\n');

    // ambiguous: 3 occurrences of the same find text -> skipped unless forced
    const patch = { file: 'src/dup.ts', find: 'extract(', replace: 'extractNew(', explanation: 'x' };
    const res = applyFixesDetailed(root, [patch], false);
    expect(res.applied).toEqual([]);
    expect(res.skipped).toEqual(['src/dup.ts (3 occurrences — ambiguous)']);

    const forced = applyFixesDetailed(root, [{ ...patch, all: true }], false);
    expect(forced.applied).toEqual(['src/dup.ts']);
    expect((readFileSync(file, 'utf8').match(/extractNew/g) ?? []).length).toBe(3);
  });
});

describe('dry-run parity', () => {
  it('dry-run refuses an ambiguous patch exactly like a real apply', () => {
    const root = mkdtempSync(join(tmpdir(), 'ambig-'));
    writeFileSync(join(root, 'a.ts'), 'x();\nx();\n');
    const p = [{ file: 'a.ts', find: 'x();', replace: 'y();', explanation: 'e' }];
    const dry = applyFixes(root, p, true);
    const wet = applyFixes(root, p, false);
    expect(dry.applied).toEqual(wet.applied); // both: nothing
    expect(dry.skipped[0]).toContain('ambiguous');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('x();\nx();\n');
  });
});
