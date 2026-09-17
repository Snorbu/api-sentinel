import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/commands.js';
import { saveSnapshot } from '../src/snapshot.js';

describe('runCheck', () => {
  it('fixture mode: --old/--new diffs two spec files, exit 1 on breaking', () => {
    const root = mkdtempSync(join(tmpdir(), 'chk-'));
    const oldP = join(root, 'old.json');
    const newP = join(root, 'new.json');
    writeFileSync(oldP, JSON.stringify({ paths: { '/v1/x': { get: { responses: {} } } } }));
    writeFileSync(newP, JSON.stringify({ paths: {} })); // endpoint removed -> breaking

    const res = runCheck({ rootDir: root, oldPath: oldP, newPath: newP, apiName: 'demo', repoDir: root });
    expect(res.exitCode).toBe(1);
    expect(res.report).toContain('Breaking changes');
  });

  it('snapshot mode: no previous snapshot -> exit 0, skip message', () => {
    const root = mkdtempSync(join(tmpdir(), 'chk2-'));
    const cfg = join(root, 'apis.yaml');
    writeFileSync(cfg, 'apis:\n  - name: a\n    specUrl: https://x/s.json\n');
    const res = runCheck({ rootDir: root, configPath: cfg, repoDir: root });
    expect(res.exitCode).toBe(0);
    expect(res.report).toContain('no previous snapshot');
  });

  it('snapshot mode: breaking diff between previous and current', () => {
    const root = mkdtempSync(join(tmpdir(), 'chk3-'));
    const cfg = join(root, 'apis.yaml');
    writeFileSync(cfg, 'apis:\n  - name: a\n    specUrl: https://x/s.json\n');
    saveSnapshot(root, 'a', { paths: { '/v1/x': {} } }, 't1');
    saveSnapshot(root, 'a', { paths: {} }, 't2');
    const res = runCheck({ rootDir: root, configPath: cfg, repoDir: root });
    expect(res.exitCode).toBe(1);
  });
});

describe('--fail-on', () => {
  const fixtureMode = (failOn?: 'breaking' | 'additive' | 'none') => {
    const root = mkdtempSync(join(tmpdir(), 'fo-'));
    return runCheck({
      rootDir: root,
      oldPath: resolve('test/fixtures/spec-v1.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      repoDir: root,
      failOn,
    });
  };

  it('failOn none: report-only mode still reports breaking but exits 0', () => {
    const res = fixtureMode('none');
    expect(res.exitCode).toBe(0);
    expect(res.report).toContain('Breaking changes');
  });

  it('failOn additive: additive changes fail the run', () => {
    expect(fixtureMode('additive').exitCode).toBe(1);
  });

  it('default (breaking): unchanged contract', () => {
    expect(fixtureMode().exitCode).toBe(1);
  });
});

describe('SDK awareness in report', () => {
  it('mentions detected vendor SDKs and coverage advice', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdkrep-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { openai: '^4.0.0' } }));
    const res = runCheck({
      rootDir: root,
      oldPath: resolve('test/fixtures/spec-v1.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      repoDir: root,
    });
    expect(res.report).toContain('Vendor SDK(s) detected: openai');
  });

  it('says nothing about SDKs when package.json is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdkrep2-'));
    const res = runCheck({
      rootDir: root,
      oldPath: resolve('test/fixtures/spec-v2.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      repoDir: root,
    });
    expect(res.report).not.toContain('Vendor SDK(s)');
  });
});

describe('--format json', () => {
  it('returns a machine-readable payload with structured changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'json-'));
    const res = runCheck({
      rootDir: root,
      oldPath: resolve('test/fixtures/spec-v1.json'),
      newPath: resolve('test/fixtures/spec-v2.json'),
      apiName: 'demo',
      repoDir: root,
      format: 'json',
    });
    const payload = JSON.parse(res.report) as {
      apis: { apiName: string; breaking: number; changes: { kind: string; path: string }[]; usages: unknown[] }[];
      exitCode: number;
    };
    expect(payload.apis).toHaveLength(1);
    expect(payload.apis[0]!.apiName).toBe('demo');
    expect(payload.apis[0]!.breaking).toBe(3);
    expect(payload.apis[0]!.changes.length).toBeGreaterThan(0);
    expect(payload.exitCode).toBe(1);
  });
});
