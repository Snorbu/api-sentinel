import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reviewPatches } from '../src/review.js';
import type { FixPatch } from '../src/fix.js';

const patch: FixPatch = {
  file: 'src/payment.ts',
  find: '{ paid: boolean }',
  replace: '{ status: string }',
  explanation: 'paid was removed; status survives',
};

const makeDeps = () => {
  const root = mkdtempSync(join(tmpdir(), 'rev-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'payment.ts'), 'const x: { paid: boolean } = JSON.parse("{}");\n');
  return { root };
};

describe('reviewPatches', () => {
  it('shows a unified-style diff and records a y decision', async () => {
    const { root } = makeDeps();
    const inputs: string[] = [];
    const res = await reviewPatches(root, [patch], {
      ask: (q) => {
        inputs.push(q);
        return Promise.resolve('y');
      },
    });
    expect(inputs[0]).toContain('- { paid: boolean }');
    expect(inputs[0]).toContain('+ { status: string }');
    expect(inputs[0]).toContain('paid was removed; status survives');
    expect(res.applied).toEqual(['src/payment.ts']);
  });

  it('n skips, a accepts all remaining, EOF defaults to skip', async () => {
    const { root } = makeDeps();
    const second: FixPatch = { ...patch, find: 'const x', replace: 'const y' };
    const answers = ['n', 'a'];
    const res = await reviewPatches(root, [patch, second], {
      ask: () => Promise.resolve(answers.shift() ?? ''),
    });
    expect(res.applied).toEqual(['src/payment.ts']); // second via 'a'
  });

  it('EOF (empty answer) on the first patch skips everything safely', async () => {
    const { root } = makeDeps();
    const res = await reviewPatches(root, [patch], { ask: () => Promise.resolve('') });
    expect(res.applied).toEqual([]);
    expect(res.decisions).toEqual([{ patch, decision: 'skip' }]);
  });
});
