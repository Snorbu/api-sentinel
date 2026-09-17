import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectSdks } from '../src/sdkDetect.js';

const writePkg = (root: string, deps: Record<string, string>): void => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: deps }));
};

describe('detectSdks', () => {
  it('maps installed SDK packages to vendor names', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdk-'));
    writePkg(root, { stripe: '^14.0.0', openai: '^4.0.0', express: '^4.0.0' });
    const vendors = detectSdks(root);
    expect(vendors).toContain('stripe');
    expect(vendors).toContain('openai');
    expect(vendors).not.toContain('express');
  });

  it('returns [] when there is no package.json', () => {
    expect(detectSdks(mkdtempSync(join(tmpdir(), 'sdk2-')))).toEqual([]);
  });

  it('returns [] when deps contain no known SDKs', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdk3-'));
    writePkg(root, { lodash: '^4.0.0' });
    expect(detectSdks(root)).toEqual([]);
  });
});
