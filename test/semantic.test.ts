import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  canonicalizeSpec,
  definitionUsage,
  normalizeSpec,
  resolveRefs,
  resolveRefsDetailed,
  usageForPath,
} from '../src/semantic.js';
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

describe('pruneInlinedDefinitions', () => {
  it('drops containers whose definitions were all inlined, husks included', () => {
    const out = normalizeSpec({
      components: { schemas: { A: { type: 'string' } } },
      paths: { '/a': { get: { s: { $ref: '#/components/schemas/A' } } } },
    }) as any;
    expect(out.components).toBeUndefined();
    expect(out.paths['/a'].get.s.type).toBe('string');
  });

  it('keeps securitySchemes and un-inlined definitions', () => {
    const out = normalizeSpec({
      components: { schemas: { A: { type: 'string' } }, securitySchemes: { bearer: { type: 'http' } } },
      paths: { '/a': { get: { s: { $ref: '#/components/schemas/A' } } } },
    }) as any;
    expect(out.components.securitySchemes.bearer.type).toBe('http');
    expect(out.components.schemas).toBeUndefined();
  });

  it('extracting a schema into components/ is not a change', () => {
    const inlineSpec = { paths: { '/c': { get: { x: { type: 'object', properties: { a: { type: 'string' } } } } } } };
    const refSpec = {
      components: { schemas: { X: { type: 'object', properties: { a: { type: 'string' } } } } },
      paths: { '/c': { get: { x: { $ref: '#/components/schemas/X' } } } },
    };
    expect(diffSpecs(inlineSpec, refSpec)).toEqual([]);
  });
});

describe('scale: fat shared schemas (real vendor specs)', () => {
  const build = (drop: boolean) => {
    const schemas: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      const props: Record<string, unknown> = {};
      for (let j = 0; j < 12; j++) props[`f${j}`] = { type: 'string' };
      if (drop && i === 0) delete props.f0;
      schemas[`Leaf${i}`] = { type: 'object', properties: props };
    }
    for (let i = 0; i < 10; i++) {
      const props: Record<string, unknown> = {};
      for (let j = 0; j < 10; j++) props[`p${j}`] = { $ref: `#/components/schemas/Leaf${j}` };
      schemas[`Big${i}`] = { type: 'object', properties: props };
    }
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      paths[`/v1/r${i}`] = {
        get: { responses: { '200': { content: { 'application/json': { schema: { $ref: `#/components/schemas/Big${i % 10}` } } } } } },
      };
    }
    return { openapi: '3.0.3', paths, components: { schemas } };
  };

  it('does not fan one shared-field removal out into thousands of rows', () => {
    const started = Date.now();
    const changes = diffSpecs(build(false), build(true));
    expect(changes.length).toBeLessThan(25); // pre-fix this was 1000s
    expect(Date.now() - started).toBeLessThan(5000);
    expect(changes.every((c) => c.path.endsWith('f0.type'))).toBe(true); // the real break, once per owner schema
  });

  it('maps a shared schema back to the endpoints that use it', () => {
    const usage = definitionUsage(build(false));
    const eps = usageForPath('components.schemas.Leaf0.properties.f0.type', usage);
    expect(eps.length).toBe(100); // every operation reaches Leaf0 transitively
    expect(eps).toContain('GET /v1/r0');
    // and the schema a change is actually reported on maps to its own callers
    expect(usageForPath('components.schemas.Big0.properties.p0.properties.f0.type', usage)).toHaveLength(10);
  });

  it('keeps oversized refs instead of inlining them', () => {
    const { inlined, kept } = resolveRefsDetailed(build(false));
    expect([...kept].some((r) => r.includes('Big'))).toBe(true);
    expect([...inlined].some((r) => r.includes('Leaf'))).toBe(true);
  });
});

describe('definitionUsage', () => {
  it('is cycle safe', () => {
    const spec = {
      paths: { '/a': { post: { body: { $ref: '#/components/schemas/Node' } } } },
      components: { schemas: { Node: { properties: { next: { $ref: '#/components/schemas/Node' } } } } },
    };
    expect(definitionUsage(spec)['components.schemas.Node']).toEqual(['POST /a']);
  });

  it('ignores non-method keys on a path item', () => {
    const spec = {
      paths: { '/a': { summary: 'x', get: { r: { $ref: '#/components/schemas/A' } } } },
      components: { schemas: { A: { type: 'string' } } },
    };
    expect(definitionUsage(spec)).toEqual({ 'components.schemas.A': ['GET /a'] });
  });
});
