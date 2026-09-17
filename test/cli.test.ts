import { describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from '../src/cli.js';

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
});
