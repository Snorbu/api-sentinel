import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyFixesVerified, dedupePatches, runVerify } from '../src/verify.js';

function repo(content = 'export const paid = true;\n'): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), content);
  return root;
}

const patch = {
  file: 'src/a.ts',
  find: 'paid = true',
  replace: 'status = "succeeded"',
  explanation: 'migrate paid -> status',
};

describe('runVerify', () => {
  it('reports success and failure with output', () => {
    const root = repo();
    expect(runVerify(root, 'exit 0').ok).toBe(true);
    const bad = runVerify(root, 'echo boom >&2; exit 3');
    expect(bad.ok).toBe(false);
    expect(bad.exitCode).toBe(3);
    expect(bad.output).toContain('boom');
  });
});

describe('applyFixesVerified', () => {
  it('keeps patches when verification passes', () => {
    const root = repo();
    const res = applyFixesVerified(root, [patch], { verifyCommand: 'exit 0' });
    expect(res.applied).toEqual(['src/a.ts']);
    expect(res.rolledBack).toBe(false);
    expect(res.verified?.ok).toBe(true);
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toContain('status = "succeeded"');
  });

  it('rolls every file back byte-for-byte when verification fails', () => {
    const original = 'export const paid = true;\n';
    const root = repo(original);
    const res = applyFixesVerified(root, [patch], { verifyCommand: 'exit 1' });
    expect(res.rolledBack).toBe(true);
    expect(res.applied).toEqual([]);
    expect(res.verified?.ok).toBe(false);
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe(original);
  });

  it('rolls back a real type error found by the verify command', () => {
    const root = repo('export function n(): number { return 1; }\n');
    const before = readFileSync(join(root, 'src', 'a.ts'), 'utf8');
    const res = applyFixesVerified(
      root,
      [{ file: 'src/a.ts', find: 'return 1;', replace: 'return "one";', explanation: 'break it' }],
      { verifyCommand: 'grep -q \'return "one";\' src/a.ts && exit 7' },
    );
    expect(res.rolledBack).toBe(true);
    expect(res.verified?.exitCode).toBe(7);
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe(before);
  });

  it('applies without verification when no command is given', () => {
    const root = repo();
    const res = applyFixesVerified(root, [patch]);
    expect(res.applied).toEqual(['src/a.ts']);
    expect(res.verified).toBeUndefined();
  });
});

describe('dedupePatches', () => {
  it('drops byte-identical patches, keeps genuinely different ones', () => {
    const other = { ...patch, find: 'other', replace: 'thing' };
    expect(dedupePatches([patch, { ...patch }, other])).toHaveLength(2);
  });
});
