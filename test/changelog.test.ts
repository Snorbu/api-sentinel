import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeChangelog,
  fetchChangelog,
  loadChangelog,
  loadPreviousChangelog,
  newLines,
  riskFindings,
  saveChangelogSnapshot,
  toLines,
} from '../src/changelog.js';
import { buildReport } from '../src/report.js';

describe('toLines', () => {
  it('strips html and collapses whitespace', () => {
    expect(toLines('<ul><li>Deprecated   <b>paid</b></li><li>New field</li></ul>')).toEqual([
      'Deprecated paid',
      'New field',
    ]);
  });

  it('passes markdown through, dropping blanks', () => {
    expect(toLines('# v2\n\n- added foo\n')).toEqual(['# v2', '- added foo']);
  });
});

describe('newLines', () => {
  it('returns only lines added since the previous snapshot', () => {
    expect(newLines('a\nb', 'a\nb\nc')).toEqual(['c']);
  });

  it('de-duplicates repeats', () => {
    expect(newLines('a', 'b\nb')).toEqual(['b']);
  });
});

describe('riskFindings', () => {
  it('flags deprecation language', () => {
    const f = riskFindings(['2026-01-01: the `paid` field is deprecated', 'minor copy tweak']);
    expect(f).toHaveLength(1);
    expect(f[0]!.keyword).toBe('deprecat');
  });

  it('ignores benign lines', () => {
    expect(riskFindings(['added a new optional field'])).toEqual([]);
  });
});

describe('analyzeChangelog', () => {
  it('returns nothing without both snapshots', () => {
    expect(analyzeChangelog(null, 'sunset soon')).toEqual([]);
    expect(analyzeChangelog('old', null)).toEqual([]);
  });

  it('finds risky new entries', () => {
    const findings = analyzeChangelog('v1 released', 'v1 released\n/v1/charges will be removed on 2026-06-01');
    expect(findings.map((f) => f.keyword)).toEqual(['will be removed']);
  });
});

describe('snapshot rotation', () => {
  it('rotates current -> previous', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentinel-cl-'));
    saveChangelogSnapshot(root, 'acme', 'first');
    expect(loadPreviousChangelog(root, 'acme')).toBeNull();
    const file = saveChangelogSnapshot(root, 'acme', 'second');
    expect(readFileSync(file, 'utf8')).toBe('second');
    expect(loadChangelog(root, 'acme')).toBe('second');
    expect(loadPreviousChangelog(root, 'acme')).toBe('first');
  });
});

describe('fetchChangelog', () => {
  it('throws on a bad status', async () => {
    const fake = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchChangelog('https://x.test/cl', fake)).rejects.toThrow(/changelog fetch failed: 500/);
  });

  it('returns the body text', async () => {
    const fake = (async () => new Response('hello')) as unknown as typeof fetch;
    expect(await fetchChangelog('https://x.test/cl', fake)).toBe('hello');
  });
});

describe('report integration', () => {
  it('renders a changelog section without affecting change counts', () => {
    const md = buildReport({
      apiName: 'acme',
      specUrl: 'u',
      fetchedAt: 't',
      changes: [],
      usages: [],
      changelog: [{ line: 'v1 will be removed', keyword: 'will be removed' }],
    });
    expect(md).toContain('Vendor changelog signals');
    expect(md).toContain('v1 will be removed');
    expect(md).toContain('No breaking changes detected');
  });
});
