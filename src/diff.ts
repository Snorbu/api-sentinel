import { normalizeSpec } from './semantic.js';

export interface SpecChange {
  kind: 'removed' | 'added' | 'changed';
  path: string;
  before?: string;
  after?: string;
}

export function flatten(spec: unknown): Map<string, string> {
  const out = new Map<string, string>();
  walk(spec, '', out);
  return out;
}

function walk(node: unknown, path: string, out: Map<string, string>): void {
  if (Array.isArray(node)) {
    if (path.endsWith('.required') && node.length > 0) {
      // one leaf per required member: required.paid = true
      for (const member of node) {
        if (typeof member === 'string') out.set(`${path}.${member}`, 'true');
      }
      return;
    }
    // arrays (and empty `required`) stay whole-value leaves
    out.set(path, JSON.stringify(node));
    return;
  }
  if (node !== null && typeof node === 'object') {
    const entries = Object.entries(node);
    if (entries.length === 0) {
      // empty containers are leaves too — their presence/absence must be diffable
      out.set(path, '{}');
      return;
    }
    for (const [k, v] of entries) {
      walk(v, path === '' ? k : `${path}.${k}`, out);
    }
    return;
  }
  out.set(path, JSON.stringify(node));
}

/**
 * Diff two specs. Both sides are semantically normalized first (local `$ref`s
 * inlined, `oneOf`/`anyOf`/`allOf` and `parameters` order neutralised) so only
 * meaningful contract changes surface.
 */
export function diffSpecs(oldSpec: unknown, newSpec: unknown): SpecChange[] {
  const a = flatten(normalizeSpec(oldSpec));
  const b = flatten(normalizeSpec(newSpec));
  const changes: SpecChange[] = [];
  for (const [path, before] of a) {
    const after = b.get(path);
    if (after === undefined) changes.push({ kind: 'removed', path, before });
    else if (after !== before) changes.push({ kind: 'changed', path, before, after });
  }
  for (const [path, after] of b) {
    if (!a.has(path)) changes.push({ kind: 'added', path, after });
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}
