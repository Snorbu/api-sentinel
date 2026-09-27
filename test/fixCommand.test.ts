import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFix } from '../src/fixCommand.js';

const goodLlm = (prompt: string): Promise<string> => {
  void prompt;
  return Promise.resolve(
    JSON.stringify({
      patches: [
        {
          file: 'src/payment.ts',
          find: '{ paid: boolean }',
          replace: '{ status: string }',
          explanation: 'paid removed; status is the surviving enum field',
        },
      ],
    }),
  );
};

describe('runFix', () => {
  it('dry-run: proposes patches without modifying files, LLM called per breaking change', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fixrun-'));
    let calls = 0;
    const llm = (p: string): Promise<string> => {
      calls++;
      void p;
      return goodLlm(p);
    };
    const res = await runFix({
      rootDir: root,
      repoDir: 'demo',
      oldPath: resolve('test/fixtures/spec-v1.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      dryRun: true,
      llm,
    });
    // the stub returns the SAME edit for each change: it is one patch, credited
    // to the change that proposed it first — not three "fixes"
    expect(res.appliedCount).toBe(1);
    expect(res.patches).toHaveLength(1);
    expect(calls).toBe(3);
    expect(res.perChange[0]!.patches).toHaveLength(1);
    expect(res.perChange.slice(1).every((pc) => pc.patches.length === 0 && pc.duplicates === 1)).toBe(true);
    // a change covered only by someone else's duplicate is not counted unresolved
    expect(res.unresolved).toHaveLength(0);
    const after = readFileSync(join('demo', 'src', 'payment.ts'), 'utf8');
    expect(after).toContain('{ paid: boolean }'); // untouched by dry-run
  });

  it('garbage LLM output is reported, not fatal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fixrun2-'));
    const res = await runFix({
      rootDir: root,
      repoDir: 'demo',
      oldPath: resolve('test/fixtures/spec-v1.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      dryRun: true,
      llm: () => Promise.resolve('sorry, I cannot help with that'),
    });
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.appliedCount).toBe(0);
  });

  it('no breaking changes -> LLM never called', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fixrun3-'));
    let calls = 0;
    const llm = (p: string): Promise<string> => {
      calls++;
      void p;
      return goodLlm(p);
    };
    const res = await runFix({
      rootDir: root,
      repoDir: 'demo',
      oldPath: resolve('test/fixtures/spec-v2.json'),
      newPath: resolve('test/fixtures/spec-v2.json'), // identical -> no changes
      apiName: 'demo',
      dryRun: true,
      llm,
    });
    expect(calls).toBe(0);
    expect(res.appliedCount).toBe(0);
    expect(res.errors).toHaveLength(0);
  });
});

describe('unresolved accounting', () => {
  it('reports changes the model could not patch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fixrun3-'));
    const res = await runFix({
      rootDir: root,
      repoDir: 'demo',
      oldPath: resolve('test/fixtures/spec-v1.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      dryRun: true,
      // valid JSON, but the anchor does not exist in the file -> zero usable patches
      llm: () =>
        Promise.resolve(
          JSON.stringify({ patches: [{ file: 'src/payment.ts', find: 'NOPE', replace: 'x', explanation: 'e' }] }),
        ),
    });
    expect(res.patches).toHaveLength(0);
    expect(res.unresolved.length).toBeGreaterThan(0);
  });
});
