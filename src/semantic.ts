/**
 * v0.4 — semantically-aware OpenAPI normalization.
 *
 * Leaf diffing is cheap but noisy: moving a schema behind a `$ref`, reordering
 * `oneOf` branches, or shuffling a `parameters` array all look like edits even
 * though the contract is identical. This module canonicalises a spec before it
 * is flattened so the differ only reports changes with real meaning:
 *
 *  - local `$ref`s (`#/components/schemas/X`, `#/$defs/X`) are inlined, with
 *    cycle protection (a recursive ref is left as-is rather than expanded).
 *  - `oneOf` / `anyOf` / `allOf` branches are sorted by canonical content, so
 *    reshuffles are a no-op.
 *  - `enum`, `required`, and `tags` member order is normalised.
 *  - `parameters` arrays become objects keyed by `in:name`, so a parameter is
 *    tracked by identity instead of by array index.
 */

const UNORDERED_SCHEMA_KEYS = new Set(['oneOf', 'anyOf', 'allOf']);
const SORTED_STRING_KEYS = new Set(['enum', 'required', 'tags']);
const MAX_DEPTH = 64;

/** Deterministic JSON with object keys sorted — used as a sort/compare key. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function pointerLookup(root: unknown, ref: string): unknown | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const rawSeg of ref.slice(2).split('/')) {
    const seg = decodeURIComponent(rawSeg.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[seg];
    if (node === undefined) return undefined;
  }
  return node;
}

/** Inline local `$ref`s. Unresolvable or recursive refs are preserved verbatim. */
export function resolveRefs(spec: unknown): unknown {
  const seen: string[] = [];
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, depth + 1));
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string') {
      const target = pointerLookup(spec, ref);
      if (target === undefined || seen.includes(ref)) return obj; // dangling or cyclic
      seen.push(ref);
      const siblings = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== '$ref'));
      const expanded = walk(target, depth + 1);
      seen.pop();
      if (expanded !== null && typeof expanded === 'object' && !Array.isArray(expanded)) {
        return { ...(expanded as Record<string, unknown>), ...siblings };
      }
      return expanded;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v, depth + 1);
    return out;
  };
  return walk(spec, 0);
}

function parameterKey(p: unknown, index: number): string {
  if (p !== null && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    if (typeof o.name === 'string') return `${typeof o.in === 'string' ? o.in : 'any'}:${o.name}`;
  }
  return `#${index}`;
}

/** Canonicalise order-insensitive constructs so reshuffles stop being "changes". */
export function canonicalizeSpec(spec: unknown): unknown {
  const walk = (node: unknown, key: string): unknown => {
    if (Array.isArray(node)) {
      const items = node.map((n) => walk(n, ''));
      if (key === 'parameters') {
        const byKey: Record<string, unknown> = {};
        items.forEach((item, i) => {
          byKey[parameterKey(item, i)] = item;
        });
        return byKey;
      }
      if (UNORDERED_SCHEMA_KEYS.has(key)) {
        return [...items].sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
      }
      if (SORTED_STRING_KEYS.has(key) && items.every((i) => typeof i === 'string')) {
        return [...(items as string[])].sort();
      }
      return items;
    }
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v, k);
    return out;
  };
  return walk(spec, '');
}

/**
 * Containers that exist only to be `$ref`-ed. Once refs are inlined they are
 * duplicate copies of the contract, so keeping them makes "extract this schema
 * into components/" look like a pile of added (sometimes "breaking") leaves.
 * `securitySchemes` is not a ref target in practice, so it stays.
 */
const DEFINITION_CONTAINERS = [
  ['components', 'schemas'],
  ['components', 'responses'],
  ['components', 'parameters'],
  ['components', 'requestBodies'],
  ['components', 'headers'],
  ['components', 'examples'],
  ['components', 'links'],
  ['components', 'callbacks'],
  ['definitions'], // swagger 2.0
  ['$defs'],
];

/** Drop inlined definition containers (non-mutating). */
export function pruneDefinitions(spec: unknown): unknown {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const root = { ...(spec as Record<string, unknown>) };
  for (const path of DEFINITION_CONTAINERS) {
    if (path.length === 1) {
      delete root[path[0]!];
      continue;
    }
    const [parent, child] = path as [string, string];
    const node = root[parent];
    if (node !== null && typeof node === 'object' && child in (node as Record<string, unknown>)) {
      const copy = { ...(node as Record<string, unknown>) };
      delete copy[child];
      // an emptied container would itself read as an added/removed leaf
      if (Object.keys(copy).length === 0) delete root[parent];
      else root[parent] = copy;
    }
  }
  return root;
}

/** Full semantic normalization: deref, drop the now-duplicate definitions, canonicalize. */
export function normalizeSpec(spec: unknown): unknown {
  return canonicalizeSpec(pruneDefinitions(resolveRefs(spec)));
}
