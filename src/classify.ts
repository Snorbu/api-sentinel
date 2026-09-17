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
    return 'additive';
  }
  if (c.path.endsWith('.enum')) {
    const before = JSON.parse(c.before ?? '[]') as unknown[];
    const after = JSON.parse(c.after ?? '[]') as unknown[];
    return after.every((v) => before.includes(v)) ? 'breaking' : 'additive'; // shrunk vs grown
  }
  if (c.path.endsWith('.type')) return 'breaking';
  return 'cosmetic';
}
