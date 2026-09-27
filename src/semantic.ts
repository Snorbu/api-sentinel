/**
 * v0.4 — semantically-aware OpenAPI normalization.
 *
 * Leaf diffing is cheap but noisy: moving a schema behind a `$ref`, reordering
 * `oneOf` branches, or shuffling a `parameters` array all look like edits even
 * though the contract is identical. This module canonicalises a spec before it
 * is flattened so the differ only reports changes with real meaning:
 *
 *  - small local `$ref`s are inlined (with cycle protection), so extracting a
 *    schema into `components/` is a no-op;
 *  - **large, widely-shared** `$ref`s are deliberately NOT inlined: real vendor
 *    specs reuse a handful of fat schemas across hundreds of operations, and
 *    inlining them turns one removed field into thousands of duplicate change
 *    rows (and gigabytes of heap). They stay refs, so the change is reported
 *    once at the definition, and `definitionUsage()` maps it back to every
 *    endpoint it affects;
 *  - `oneOf` / `anyOf` / `allOf` branches are sorted by canonical content;
 *  - `enum`, `required`, and `tags` member order is normalised;
 *  - `parameters` arrays become objects keyed by `in:name`, so a parameter is
 *    tracked by identity instead of by array index.
 */

const UNORDERED_SCHEMA_KEYS = new Set(['oneOf', 'anyOf', 'allOf']);
const SORTED_STRING_KEYS = new Set(['enum', 'required', 'tags']);
const MAX_DEPTH = 64;

/** Max leaves a `$ref` target may expand to before we stop inlining it. */
export const INLINE_LEAF_BUDGET = 64;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

/** Deterministic JSON with object keys sorted — used as a sort/compare key. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function refSegments(ref: string): string[] {
  return ref
    .slice(2)
    .split('/')
    .map((seg) => decodeURIComponent(seg.replace(/~1/g, '/').replace(/~0/g, '~')));
}

function pointerLookup(root: unknown, ref: string): unknown | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const seg of refSegments(ref)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[seg];
    if (node === undefined) return undefined;
  }
  return node;
}

function countLeaves(node: unknown, budget: number): number {
  if (node === null || typeof node !== 'object') return 1;
  let n = 0;
  for (const v of Object.values(node as Record<string, unknown>)) {
    n += countLeaves(v, budget);
    if (n > budget) return n; // early out: we only care whether we blew the budget
  }
  return n;
}


export interface ResolveResult {
  spec: unknown;
  /** Refs fully inlined everywhere they appear (safe to prune). */
  inlined: Set<string>;
  /** Refs deliberately left in place (too large to inline). */
  kept: Set<string>;
}

/**
 * Inline local `$ref`s under a size budget. Unresolvable, recursive, and
 * oversized refs are preserved verbatim. Resolved targets are shared by
 * reference (never deep-copied), so memory stays flat.
 */
export function resolveRefsDetailed(spec: unknown, budget = INLINE_LEAF_BUDGET): ResolveResult {
  const inlined = new Set<string>();
  const kept = new Set<string>();
  const memo = new Map<string, unknown>();
  const sizes = new Map<string, number>();
  const stack: string[] = [];

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, depth + 1));
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string') {
      const target = pointerLookup(spec, ref);
      if (target === undefined || stack.includes(ref)) {
        kept.add(ref); // dangling or cyclic — leave it alone
        return obj;
      }
      // Size is measured on the *expanded* target: a definition that looks
      // tiny can explode once its own refs are resolved (20 props × 20 props …).
      let expanded = memo.get(ref);
      if (expanded === undefined) {
        stack.push(ref);
        expanded = walk(target, depth + 1);
        stack.pop();
        memo.set(ref, expanded);
      }
      let size = sizes.get(ref);
      if (size === undefined) {
        size = countLeaves(expanded, budget);
        sizes.set(ref, size);
      }
      if (size > budget) {
        kept.add(ref); // fat shared schema: report it once, at the definition
        return obj;
      }
      inlined.add(ref);
      const siblings = Object.entries(obj).filter(([k]) => k !== '$ref');
      if (siblings.length === 0) return expanded;
      if (expanded !== null && typeof expanded === 'object' && !Array.isArray(expanded)) {
        return { ...(expanded as Record<string, unknown>), ...Object.fromEntries(siblings) };
      }
      return expanded;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v, depth + 1);
    return out;
  };

  const resolved = walk(spec, 0);
  for (const ref of kept) inlined.delete(ref); // used both ways → must survive pruning
  return { spec: resolved, inlined, kept };
}

/** Back-compat helper: inline what is safe to inline and return the spec. */
export function resolveRefs(spec: unknown, budget = INLINE_LEAF_BUDGET): unknown {
  return resolveRefsDetailed(spec, budget).spec;
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
 * Drop definitions that were fully inlined (they are duplicates now). Refs that
 * survived inlining keep their definitions — that is where their diff lives.
 */
export function pruneInlinedDefinitions(spec: unknown, inlined: Iterable<string>): unknown {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const root = { ...(spec as Record<string, unknown>) };
  for (const ref of inlined) {
    if (!ref.startsWith('#/')) continue;
    const segs = refSegments(ref);
    // clone the containers along the path, then delete the leaf definition
    const containers: Record<string, unknown>[] = [root];
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const parent = containers[i]!;
      const next = parent[segs[i]!];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        ok = false;
        break;
      }
      const copy = { ...(next as Record<string, unknown>) };
      parent[segs[i]!] = copy;
      containers.push(copy);
    }
    if (!ok) continue;
    delete containers[containers.length - 1]![segs[segs.length - 1]!];
    // an emptied container would itself read as an added/removed leaf
    for (let i = containers.length - 1; i > 0; i--) {
      if (Object.keys(containers[i]!).length === 0) delete containers[i - 1]![segs[i - 1]!];
    }
  }
  return root;
}

/** Full semantic normalization: deref (budgeted), prune duplicates, canonicalize. */
export function normalizeSpec(spec: unknown, budget = INLINE_LEAF_BUDGET): unknown {
  const { spec: resolved, inlined } = resolveRefsDetailed(spec, budget);
  return canonicalizeSpec(pruneInlinedDefinitions(resolved, inlined));
}

/**
 * Map every definition (`components.schemas.Foo`, `$defs.Bar`, …) to the
 * operations that reach it, directly or through other refs. Lets the report
 * answer "a shared schema changed — which endpoints does that break?".
 */
export function definitionUsage(spec: unknown): Record<string, string[]> {
  if (spec === null || typeof spec !== 'object') return {};
  const root = spec as Record<string, unknown>;
  const direct = new Map<string, Set<string>>(); // ref -> refs it points at

  const collectRefs = (node: unknown, into: Set<string>, depth: number): void => {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) collectRefs(n, into, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) into.add(v);
      else collectRefs(v, into, depth + 1);
    }
  };

  const refsOf = (ref: string): Set<string> => {
    const cached = direct.get(ref);
    if (cached) return cached;
    const set = new Set<string>();
    direct.set(ref, set); // set before recursing: cycle-safe
    collectRefs(pointerLookup(root, ref), set, 0);
    return set;
  };

  const usage: Record<string, Set<string>> = {};
  const paths = root.paths;
  if (paths === null || typeof paths !== 'object') return {};
  for (const [urlPath, item] of Object.entries(paths as Record<string, unknown>)) {
    if (item === null || typeof item !== 'object') continue;
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const endpoint = `${method.toUpperCase()} ${urlPath}`;
      const seeds = new Set<string>();
      collectRefs(op, seeds, 0);
      const queue = [...seeds];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const ref = queue.shift()!;
        if (seen.has(ref)) continue;
        seen.add(ref);
        const key = refSegments(ref).join('.');
        (usage[key] ??= new Set()).add(endpoint);
        for (const child of refsOf(ref)) if (!seen.has(child)) queue.push(child);
      }
    }
  }
  return Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, [...v].sort()]));
}

/** Longest definition key in `usage` that prefixes `changePath`, if any. */
export function usageForPath(changePath: string, usage: Record<string, string[]>): string[] {
  let best: string | undefined;
  for (const key of Object.keys(usage)) {
    if ((changePath === key || changePath.startsWith(`${key}.`)) && (best === undefined || key.length > best.length)) {
      best = key;
    }
  }
  return best === undefined ? [] : usage[best]!;
}
