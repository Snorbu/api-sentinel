import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/report.js';

describe('buildReport', () => {
  it('groups by severity and lists affected code', () => {
    const md = buildReport({
      apiName: 'stripe',
      specUrl: 'https://example.com/stripe.json',
      fetchedAt: '2026-09-17T12:00:00Z',
      changes: [
        { kind: 'removed', path: 'paths./v1/charges.get...properties.paid.type', before: '"boolean"' },
        { kind: 'added', path: '...properties.receipt_url.type', after: '"string"' },
      ],
      usages: [{ file: 'src/payment.ts', line: 7, token: 'paid', snippet: 'return body.paid;' }],
    });
    expect(md).toContain('# API Sentinel report — stripe');
    expect(md).toContain('breaking: 1, additive: 1, cosmetic: 0');
    expect(md).toContain('`removed` `paths./v1/charges.get...properties.paid.type`');
    expect(md).toContain('src/payment.ts:7');
  });

  it('is calm when nothing broke', () => {
    const md = buildReport({
      apiName: 'x',
      specUrl: 'u',
      fetchedAt: 't',
      changes: [{ kind: 'added', path: '...properties.new_thing.type', after: '"string"' }],
      usages: [],
    });
    expect(md).toContain('No breaking changes detected');
  });
});
