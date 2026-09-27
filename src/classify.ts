import type { SpecChange } from './diff.js';

export type Severity = 'breaking' | 'additive' | 'cosmetic';

export function classify(c: SpecChange): Severity {
  if (c.kind === 'removed') {
    if (/\.required\.[^.]+$/.test(c.path)) return 'cosmetic'; // field became optional
    if (/\.description$/.test(c.path)) return 'cosmetic'; // docs-only removal
    return 'breaking';
  }
  if (c.kind === 'added') {
    if (/\.required\.[^.]+$/.test(c.path)) return 'breaking'; // new required param
    // a whole parameter appearing already-required is breaking
    if (/\.parameters\.[^.]+\.required$/.test(c.path) && c.after === 'true') return 'breaking';
    if (/\.parameters\.[^.]+\.(name|in)$/.test(c.path)) return 'additive'; // new optional parameter
    return 'additive';
  }
  if (c.path.endsWith('.enum')) {
    const before = JSON.parse(c.before ?? '[]') as unknown[];
    const after = JSON.parse(c.after ?? '[]') as unknown[];
    return after.every((v) => before.includes(v)) ? 'breaking' : 'additive'; // shrunk vs grown
  }
  // optional -> required on an existing parameter
  if (/\.parameters\.[^.]+\.required$/.test(c.path)) return c.after === 'true' ? 'breaking' : 'cosmetic';
  if (c.path.endsWith('.type')) return 'breaking';
  return 'cosmetic';
}
