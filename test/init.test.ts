import { describe, expect, it } from 'vitest';
import { generateConfig, SPEC_REGISTRY } from '../src/init.js';

describe('generateConfig', () => {
  it('maps known vendor deps to registry spec URLs', () => {
    const yaml = generateConfig({ dependencies: { stripe: '^14', openai: '^4' }, devDependencies: {} });
    expect(yaml).toContain('name: stripe');
    expect(yaml).toContain('https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml');
    expect(yaml).toContain('name: openai');
  });

  it('emits a helpful skeleton when nothing is recognized', () => {
    const yaml = generateConfig({ dependencies: { lodash: '^4' }, devDependencies: {} });
    expect(yaml).toContain('# No vendor APIs detected automatically');
    expect(yaml).toContain('specUrl: https://');
  });

  it('registry covers the popular vendors', () => {
    for (const v of ['stripe', 'openai', 'github', 'slack', 'shopify', 'twilio']) {
      expect(SPEC_REGISTRY[v]).toBeTruthy();
    }
  });
});
