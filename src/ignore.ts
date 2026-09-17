import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpecChange } from './diff.js';
import type { UsageHit } from './scan.js';

export interface IgnoreRules {
  tokens: string[];
  paths: string[];
  files: string[];
}

/** Load `.sentinelignore` from rootDir. Missing file = no rules. */
export function loadIgnore(rootDir: string): IgnoreRules {
  const f = join(rootDir, '.sentinelignore');
  const rules: IgnoreRules = { tokens: [], paths: [], files: [] };
  if (!existsSync(f)) return rules;
  for (const raw of readFileSync(f, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? '' : line.slice(sp + 1).trim();
    if (key === 'token' && value) rules.tokens.push(value);
    else if (key === 'path' && value) rules.paths.push(value);
    else if (key === 'file' && value) rules.files.push(value);
  }
  return rules;
}

function matchesAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.includes(p));
}

/** Drop spec changes whose path touches an ignored API path prefix. */
export function filterChanges(changes: SpecChange[], rules: IgnoreRules): SpecChange[] {
  if (rules.paths.length === 0) return changes;
  return changes.filter((c) => !matchesAny(c.path, rules.paths));
}

/** Drop ignored tokens from the scan list (exact match). */
export function filterTokens(tokens: string[], rules: IgnoreRules): string[] {
  if (rules.tokens.length === 0) return tokens;
  return tokens.filter((t) => !rules.tokens.includes(t));
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  if (glob.includes('**')) {
    return new RegExp(`(^|/)${esc.replace(/\*\*/g, '.*')}`);
  }
  // single * matches within one path segment (basename-style)
  const pattern = esc.replace(/\*/g, '[^/]*');
  return new RegExp(`(?:^|/)${pattern}$`);
}

/** Drop hits in ignored files (glob: * = segment, ** = any depth). */
export function filterHits(hits: UsageHit[], rules: IgnoreRules): UsageHit[] {
  if (rules.files.length === 0) return hits;
  const res = rules.files.map(globToRegExp);
  return hits.filter((h) => !res.some((re) => re.test(h.file)));
}
