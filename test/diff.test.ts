import { describe, expect, it } from 'vitest';
import { diffSpecs, flatten } from '../src/diff.js';

const V1 = {
  openapi: '3.0.3',
  paths: {
    '/v1/charges': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['paid'],
                  properties: {
                    paid: { type: 'boolean' },
                    status: { type: 'string', enum: ['succeeded', 'failed'] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe('flatten', () => {
  it('emits one leaf per primitive, and per required member', () => {
    const flat = flatten(V1);
    expect(flat.get('paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type')).toBe(
      '"boolean"',
    );
    expect(flat.get('paths./v1/charges.get.responses.200.content.application/json.schema.required.paid')).toBe('true');
    // arrays other than `required` stay whole-value leaves:
    expect(flat.get('paths./v1/charges.get.responses.200.content.application/json.schema.properties.status.enum')).toBe(
      '["succeeded","failed"]',
    );
  });
});

describe('diffSpecs', () => {
  it('detects removed, added and changed leaves', () => {
    const V2 = structuredClone(V1) as typeof V1;
    // @ts-expect-error mutating fixture
    delete V2.paths['/v1/charges'].get.responses['200'].content['application/json'].schema.properties.paid;
    // @ts-expect-error mutating fixture
    V2.paths['/v1/charges'].get.responses['200'].content['application/json'].schema.properties.status.enum = [
      'succeeded',
    ];

    const changes = diffSpecs(V1, V2);
    const paths = changes.map((c) => `${c.kind}:${c.path}`);
    expect(paths).toContain(
      'removed:paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type',
    );
    expect(paths).toContain('removed:paths./v1/charges.get.responses.200.content.application/json.schema.required.paid');
    expect(paths).toContain(
      'changed:paths./v1/charges.get.responses.200.content.application/json.schema.properties.status.enum',
    );
  });

  it('returns [] for identical specs', () => {
    expect(diffSpecs(V1, structuredClone(V1))).toEqual([]);
  });
});
