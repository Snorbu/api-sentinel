import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify.js';

describe('classify', () => {
  it('removed property leaf = breaking', () => {
    expect(
      classify({ kind: 'removed', path: 'paths./v1/charges.get...properties.paid.type', before: '"boolean"' }),
    ).toBe('breaking');
  });

  it('removed required-member = cosmetic (field became optional)', () => {
    expect(classify({ kind: 'removed', path: '...schema.required.paid', before: 'true' })).toBe('cosmetic');
  });

  it('added required-member = breaking (new required param)', () => {
    expect(classify({ kind: 'added', path: '...schema.required.customer', after: 'true' })).toBe('breaking');
  });

  it('added ordinary leaf = additive', () => {
    expect(classify({ kind: 'added', path: '...properties.receipt_url.type', after: '"string"' })).toBe('additive');
  });

  it('changed .type = breaking', () => {
    expect(
      classify({ kind: 'changed', path: '...properties.amount.type', before: '"integer"', after: '"string"' }),
    ).toBe('breaking');
  });

  it('shrunk .enum = breaking', () => {
    expect(
      classify({
        kind: 'changed',
        path: '...status.enum',
        before: '["succeeded","failed"]',
        after: '["succeeded"]',
      }),
    ).toBe('breaking');
  });

  it('grown .enum = additive', () => {
    expect(
      classify({
        kind: 'changed',
        path: '...status.enum',
        before: '["succeeded"]',
        after: '["succeeded","partial"]',
      }),
    ).toBe('additive');
  });

  it('changed description = cosmetic', () => {
    expect(classify({ kind: 'changed', path: '...properties.note.description', before: '"a"', after: '"b"' })).toBe(
      'cosmetic',
    );
  });
});
