import { describe, expect, it } from 'vitest';
import { explainChange } from '../src/explain.js';

describe('explainChange', () => {
  it('removed response field: reading it now yields undefined', () => {
    const e = explainChange({
      kind: 'removed',
      path: 'paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type',
      before: '"boolean"',
    });
    expect(e).toContain('`paid`');
    expect(e).toContain('removed');
    expect(e).toContain('undefined');
  });

  it('new required field: requests missing it are rejected', () => {
    const e = explainChange({
      kind: 'added',
      path: '...schema.required.customer_id',
      after: 'true',
    });
    expect(e).toContain('`customer_id`');
    expect(e).toContain('required');
    expect(e).toContain('rejected');
  });

  it('type change: names the before and after types', () => {
    const e = explainChange({
      kind: 'changed',
      path: '...properties.amount.type',
      before: '"integer"',
      after: '"string"',
    });
    expect(e).toContain('integer');
    expect(e).toContain('string');
    expect(e).toContain('`amount`');
  });

  it('shrunk enum: names the dropped value', () => {
    const e = explainChange({
      kind: 'changed',
      path: '...properties.status.enum',
      before: '["succeeded","failed"]',
      after: '["succeeded"]',
    });
    expect(e).toContain('`failed`');
    expect(e).toContain('no longer');
  });

  it('endpoint removal: says calls will fail', () => {
    const e = explainChange({ kind: 'removed', path: 'paths./v1/x.get.responses', before: '{}' });
    expect(e).toContain('`/v1/x`');
    expect(e).toContain('fail');
  });
});
