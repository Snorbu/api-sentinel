import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalizeSpec, normalizeSpec, resolveRefs } from '../src/semantic.js';
import { diffSpecs } from '../src/diff.js';
import { classify } from '../src/classify.js';
import { extractTokens } from '../src/scan.js';

describe('canonicalJson', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});

describe('resolveRefs', () => {
  it('inlines local refs', () => {
    const spec = {
      components: { schemas: { Charge: { type: 'object', properties: { paid: { type: 'boolean' } } } } },
      paths: { '/c': { get: { responses: { '200': { $ref: '#/components/schemas/Charge' } } } } },
    };
    const out = resolveRefs(spec) as any;
    expect(out.paths['/c'].get.responses['200'].properties.paid.type).toBe('boolean');
  });

  it('keeps sibling keys and survives recursive refs', () => {
    const spec = {
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
      root: { $ref: '#/$defs/Node', description: 'tree' },
    };
    const out = resolveRefs(spec) as any;
    expect(out.root.type).toBe('object');
    expect(out.root.description).toBe('tree');
    expect(out.root.properties.next.$ref).toBe('#/$defs/Node');
  });

  it('leaves dangling refs untouched', () => {
    const out = resolveRefs({ a: { $ref: '#/nope/missing' } }) as any;
    expect(out.a.$ref).toBe('#/nope/missing');
  });
});

describe('canonicalizeSpec', () => {
  it('sorts oneOf branches and enum/required members', () => {
    const a = canonicalizeSpec({ oneOf: [{ type: 'string' }, { type: 'number' }], enum: ['b', 'a'], required: ['y', 'x'] });
    const b = canonicalizeSpec({ oneOf: [{ type: 'number' }, { type: 'string' }], enum: ['a', 'b'], required: ['x', 'y'] });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('keys parameters by in:name', () => {
    const out = canonicalizeSpec({ parameters: [{ name: 'limit', in: 'query' }] }) as any;
    expect(Object.keys(out.parameters)).toEqual(['query:limit']);
  });
});

describe('semantic diffing (v0.4)', () => {
  const inline = {
    paths: { '/c': { get: { responses: { '200': { type: 'object', properties: { paid: { type: 'boolean' } } } } } } },
  };
  const viaRef = {
    components: { schemas: { Charge: { type: 'object', properties: { paid: { type: 'boolean' } } } } },
    paths: { '/c': { get: { responses: { '200': { $ref: '#/components/schemas/Charge' } } } } },
  };

  it('reports no change when a schema moves behind a $ref', () => {
    const changes = diffSpecs(inline, viaRef).filter((c) => c.path.startsWith('paths.'));
    expect(changes).toEqual([]);
  });

  it('ignores oneOf reshuffles', () => {
    const one = { s: { oneOf: [{ type: 'string' }, { type: 'null' }] } };
    const two = { s: { oneOf: [{ type: 'null' }, { type: 'string' }] } };
    expect(diffSpecs(one, two)).toEqual([]);
  });

  it('ignores parameter reordering but catches a new required parameter', () => {
    const p = (list: unknown[]) => ({ paths: { '/c': { get: { parameters: list } } } });
    const before = p([{ name: 'limit', in: 'query' }, { name: 'cursor', in: 'query' }]);
    const reordered = p([{ name: 'cursor', in: 'query' }, { name: 'limit', in: 'query' }]);
    expect(diffSpecs(before, reordered)).toEqual([]);

    const added = p([
      { name: 'limit', in: 'query' },
      { name: 'cursor', in: 'query' },
      { name: 'account_id', in: 'query', required: true },
    ]);
    const changes = diffSpecs(before, added);
    const req = changes.find((c) => c.path.endsWith('parameters.query:account_id.required'));
    expect(req).toBeDefined();
    expect(classify(req!)).toBe('breaking');
    expect(extractTokens(changes)).toContain('account_id');
  });

  it('flags an existing parameter becoming required', () => {
    const p = (required: boolean) => ({
      paths: { '/c': { get: { parameters: [{ name: 'account_id', in: 'query', required }] } } },
    });
    const change = diffSpecs(p(false), p(true)).find((c) => c.path.endsWith('.required'))!;
    expect(classify(change)).toBe('breaking');
  });

  it('normalizeSpec is idempotent', () => {
    const once = normalizeSpec(viaRef);
    expect(canonicalJson(normalizeSpec(once))).toBe(canonicalJson(once));
  });
});
