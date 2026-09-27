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

describe('explanations in report', () => {
  it('renders the plain-English sentence under each breaking change', () => {
    const md = buildReport({
      apiName: 'stripe',
      specUrl: 'u',
      fetchedAt: 't',
      changes: [
        {
          kind: 'removed',
          path: 'paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type',
          before: '"boolean"',
        },
      ],
      usages: [],
    });
    expect(md).toContain('→');
    expect(md).toContain('code reading it now gets `undefined`');
  });
});

describe('grouping', () => {
  const sameBreakOn = (url: string) => ({
    kind: 'removed' as const,
    path: `paths.${url}.get.responses.200.content.application/json.schema.properties.paid.type`,
    before: '"boolean"',
  });

  it('collapses one shared break across endpoints into a single row', () => {
    const md = buildReport({
      apiName: 'acme',
      specUrl: 'u',
      fetchedAt: 't',
      changes: [sameBreakOn('/v1/a'), sameBreakOn('/v1/b'), sameBreakOn('/v1/c')],
      usages: [],
    });
    expect(md).toContain('- breaking: 3');
    expect(md).toContain('distinct breaking changes: 1');
    expect(md).toContain('affects 3 endpoints');
    expect(md).toContain('`GET /v1/a`');
    expect(md.match(/^- `removed`/gm)).toHaveLength(1);
  });

  it('keeps distinct breaks separate and shows the full path for a single hit', () => {
    const md = buildReport({
      apiName: 'acme',
      specUrl: 'u',
      fetchedAt: 't',
      changes: [sameBreakOn('/v1/a')],
      usages: [],
    });
    expect(md).toContain('paths./v1/a.get');
    expect(md).not.toContain('distinct breaking changes');
  });

  it('annotates shared-definition changes with their callers', () => {
    const md = buildReport({
      apiName: 'acme',
      specUrl: 'u',
      fetchedAt: 't',
      changes: [{ kind: 'removed', path: 'components.schemas.Charge.properties.paid.type', before: '"boolean"' }],
      usages: [],
      refUsage: { 'components.schemas.Charge': ['GET /v1/a', 'POST /v1/b'] },
    });
    expect(md).toContain('affects 2 endpoints: `GET /v1/a`, `POST /v1/b`');
  });
});
