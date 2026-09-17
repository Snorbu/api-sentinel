import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli.js';

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
