import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'cfg-'));

describe('loadConfig', () => {
  it('loads a valid apis.yaml', () => {
    const dir = tmp();
    const p = join(dir, 'apis.yaml');
    writeFileSync(p, 'apis:\n  - name: stripe\n    specUrl: https://example.com/stripe.json\n');
    expect(loadConfig(p)).toEqual({
      apis: [{ name: 'stripe', specUrl: 'https://example.com/stripe.json' }],
    });
  });

  it('rejects a non-slug name', () => {
    const dir = tmp();
    const p = join(dir, 'apis.yaml');
    writeFileSync(p, 'apis:\n  - name: "Stripe!!"\n    specUrl: https://x.com/s.json\n');
    expect(() => loadConfig(p)).toThrow(/lowercase slug/);
  });

  it('rejects an empty api list', () => {
    const dir = tmp();
    const p = join(dir, 'apis.yaml');
    writeFileSync(p, 'apis: []\n');
    expect(() => loadConfig(p)).toThrow(/at least one api/);
  });

  it('rejects a missing file', () => {
    expect(() => loadConfig('/nonexistent/apis.yaml')).toThrow(/config not found/);
  });
});
