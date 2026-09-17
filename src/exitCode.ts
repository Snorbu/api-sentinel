import { classify, type Severity } from './classify.js';
import type { SpecChange } from './diff.js';

export type FailOn = 'breaking' | 'additive' | 'none';

const RANK: Record<Severity, number> = { breaking: 3, additive: 2, cosmetic: 1 };

export function exitCodeFor(changes: SpecChange[], failOn: FailOn): number {
  if (failOn === 'none') return 0;
  const threshold = RANK[failOn];
  return changes.some((c) => RANK[classify(c)] >= threshold) ? 1 : 0;
}
