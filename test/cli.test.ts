import { describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from '../src/cli.js';
import { resolve } from 'node:path';

describe('parseArgs', () => {
  it('splits positional commands from --flags', () => {
    expect(parseArgs(['check', '--config', 'apis.yaml', '--repo', '.'])).toEqual({
      _: ['check'],
      config: 'apis.yaml',
      repo: '.',
    });
  });

  it('treats a flag with no value as "true"', () => {
    expect(parseArgs(['snapshot', '--verbose'])).toEqual({ _: ['snapshot'], verbose: 'true' });
  });

  it('keeps empty input safe', () => {
    expect(parseArgs([])).toEqual({ _: [] });
  });
});

describe('previewCheckDeps', () => {
  it('fixture mode by default (demo fixtures, demo name)', async () => {
    const { previewCheckDeps } = await import('../src/cli.js');
    const deps = previewCheckDeps({ _: ['preview'] }, '/root');
    expect(deps.oldPath).toContain('spec-v1.json');
    expect(deps.newPath).toContain('spec-v2.json');
    expect(deps.apiName).toBe('demo');
    expect(deps.configPath).toBeUndefined();
  });

  it('config mode takes precedence: no old/new paths', async () => {
    const { previewCheckDeps } = await import('../src/cli.js');
    const deps = previewCheckDeps({ _: ['preview'], config: 'apis.yaml' }, '/root');
    expect(deps.configPath).toBe('apis.yaml');
    expect(deps.oldPath).toBeUndefined();
    expect(deps.newPath).toBeUndefined();
  });
});

describe('main error handling', () => {
  it('returns 2 + prints error on unreadable config', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['check', '--config', '/nonexistent/apis.yaml']);
    expect(code).toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('error:'));
    err.mockRestore();
  });

  it('empty --api falls back to demo name in fixture mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main([
      'check',
      '--old',
      resolve('test/fixtures/spec-v1.json'),
      '--new',
      resolve('test/fixtures/spec-v2.json'),
      '--api',
      '',
      '--repo',
      'demo',
    ]);
    expect(code).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('# API Sentinel report — demo'));
    log.mockRestore();
  });
});

describe('snapshot failure UX', () => {
  it('continues past a failing API, reports both outcomes, exits nonzero', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'snapux-'));
    const cfg = join(root, 'apis.yaml');
    writeFileSync(
      cfg,
      'apis:\n' +
        '  - name: bad\n    specUrl: http://127.0.0.1:1/unreachable.json\n' +
        '  - name: alsobad\n    specUrl: http://127.0.0.1:1/unreachable2.json\n',
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['snapshot', '--config', cfg, '--root', root]);
    expect(code).toBe(1);
    const errText = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(errText).toContain('bad');
    log.mockRestore();
    err.mockRestore();
  });
});
