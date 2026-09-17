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
