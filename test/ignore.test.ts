import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterChanges, filterHits, filterTokens, loadIgnore } from '../src/ignore.js';
import type { SpecChange } from '../src/diff.js';
import type { UsageHit } from '../src/scan.js';

describe('loadIgnore', () => {
  it('returns empty rules when no file exists', () => {
    expect(loadIgnore(mkdtempSync(join(tmpdir(), 'ig-')))).toEqual({ tokens: [], paths: [], files: [] });
  });

  it('parses token/path/file rules, skipping comments and blanks', () => {
    const root = mkdtempSync(join(tmpdir(), 'ig-'));
    writeFileSync(
      join(root, '.sentinelignore'),
      '# why: own status field everywhere\n token paid\n\npath /v1/internal\nfile *.test.ts\n',
    );
    expect(loadIgnore(root)).toEqual({
      tokens: ['paid'],
      paths: ['/v1/internal'],
      files: ['*.test.ts'],
    });
  });
});

describe('filterChanges', () => {
  const changes: SpecChange[] = [
    { kind: 'removed', path: 'paths./v1/internal/reset.post.responses.200.content.application/json.schema.properties.ok.type', before: '"boolean"' },
    { kind: 'removed', path: 'paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type', before: '"boolean"' },
  ];

  it('drops changes under ignored path prefixes, keeps the rest', () => {
    const kept = filterChanges(changes, { tokens: [], paths: ['/v1/internal'], files: [] });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.path).toContain('/v1/charges');
  });

  it('keeps everything when no path rules', () => {
    expect(filterChanges(changes, { tokens: [], paths: [], files: [] })).toHaveLength(2);
  });
});

describe('filterTokens', () => {
  it('drops ignored tokens exactly', () => {
    expect(filterTokens(['paid', 'status', 'customer_id'], { tokens: ['status'], paths: [], files: [] })).toEqual([
      'paid',
      'customer_id',
    ]);
  });
});

describe('filterHits', () => {
  const hits: UsageHit[] = [
    { file: 'src/payment.ts', line: 5, token: 'paid', snippet: 'x' },
    { file: 'src/payment.test.ts', line: 9, token: 'paid', snippet: 'x' },
    { file: 'test/helpers.ts', line: 2, token: 'paid', snippet: 'x' },
  ];

  it('supports single-star globs against the basename', () => {
    const kept = filterHits(hits, { tokens: [], paths: [], files: ['*.test.ts'] });
    expect(kept.map((h) => h.file)).toEqual(['src/payment.ts', 'test/helpers.ts']); // only payment.test.ts matched
  });

  it('supports double-star directory globs', () => {
    const kept = filterHits(hits, { tokens: [], paths: [], files: ['test/**'] });
    expect(kept.map((h) => h.file)).toEqual(['src/payment.ts', 'src/payment.test.ts']);
  });
});

describe('workspaces', () => {
  it('skips workspace member node_modules subtrees and respects nested sentinelignore', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { scanRepo } = await import('../src/scan.js');
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    // monorepo: packages/api has its own node_modules that must be skipped
    mkdirSync(join(root, 'packages', 'api', 'node_modules', 'vend'), { recursive: true });
    mkdirSync(join(root, 'packages', 'api', 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', 'api', 'src', 'client.ts'), 'const url = "/v1/charges";\n');
    writeFileSync(join(root, 'packages', 'api', 'node_modules', 'vend', 'x.ts'), 'const url = "/v1/charges";\n');
    // nested ignore: packages/web ignores everything
    mkdirSync(join(root, 'packages', 'web'), { recursive: true });
    writeFileSync(join(root, 'packages', 'web', 'src.ts'), 'const url = "/v1/charges";\n');
    writeFileSync(join(root, 'packages', 'web', '.sentinelignore'), 'file **\n');

    const hits = scanRepo(root, ['/v1/charges']);
    const files = hits.map((h) => h.file);
    expect(files.some((f) => f.includes('client.ts'))).toBe(true);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('web'))).toBe(false);
  });
});
