import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTokens, scanRepo } from '../src/scan.js';

describe('extractTokens', () => {
  it('pulls endpoint URLs and property names from breaking changes only', () => {
    const tokens = extractTokens([
      {
        kind: 'removed',
        path: 'paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type',
      },
      { kind: 'removed', path: '...schema.required.paid' }, // cosmetic -> ignored
      { kind: 'added', path: '...properties.receipt_url.type' }, // additive -> ignored
      {
        kind: 'removed',
        path: 'paths./v1/charges.get.responses.200.content.application/json.schema.properties.id.type',
      }, // len<=2 ignored
    ]);
    expect(tokens).toContain('/v1/charges');
    expect(tokens).toContain('paid');
    expect(tokens).not.toContain('receipt_url');
    expect(tokens).not.toContain('id');
  });
});

describe('scanRepo', () => {
  it('finds file:line usages and skips node_modules/dist/snapshots', () => {
    const root = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'src', 'payment.ts'), 'const url = "/v1/charges";\nconst ok = body.paid;\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.ts'), 'const url = "/v1/charges";\n');

    const hits = scanRepo(root, ['/v1/charges', 'paid']);
    const files = hits.map((h) => h.file);
    expect(files.some((f) => f.endsWith('src/payment.ts'))).toBe(true);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(hits.find((h) => h.token === 'paid')?.line).toBe(2);
  });

  it('returns [] when nothing matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'repo2-'));
    writeFileSync(join(root, 'a.ts'), 'nothing here\n');
    expect(scanRepo(root, ['/v1/nope'])).toEqual([]);
  });
});

describe('scanRepo precision', () => {
  it('does not match tokens inside larger words', () => {
    const root = mkdtempSync(join(tmpdir(), 'scanp-'));
    writeFileSync(
      join(root, 'a.ts'),
      'const unparsed = 1; // repaid invoices are excluded\nconst x = body.paid;\n',
    );
    const hits = scanRepo(root, ['paid']);
    expect(hits.map((h) => h.line)).toEqual([2]);
  });

  it('skips fixtures and test dirs by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'scanskip-'));
    mkdirSync(join(root, 'fixtures'), { recursive: true });
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'fixtures', 'f.ts'), 'const url = "/v1/charges";\n');
    writeFileSync(join(root, 'test', 't.ts'), 'const url = "/v1/charges";\n');
    writeFileSync(join(root, 'keep.ts'), 'const url = "/v1/charges";\n');
    const hits = scanRepo(root, ['/v1/charges']);
    expect(hits.map((h) => h.file)).toEqual([join(root, 'keep.ts')]);
  });
});
