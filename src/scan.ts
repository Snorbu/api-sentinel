import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classify } from './classify.js';
import type { SpecChange } from './diff.js';
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rb', '.php', '.java']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'snapshots', 'fixtures', 'test', 'tests', '__tests__']);

export interface UsageHit {
  file: string;
  line: number;
  token: string;
  snippet: string;
}

export function extractTokens(changes: SpecChange[]): string[] {
  const tokens = new Set<string>();
  for (const c of changes) {
    if (classify(c) !== 'breaking') continue;
    const url = c.path.match(/^paths\.(\S+?)\.(get|post|put|patch|delete|head|options)\./);
    if (url) tokens.add(url[1]!);
    const prop = c.path.match(/\.properties\.([A-Za-z0-9_]+)(?:\.|$)/);
    if (prop && prop[1]!.length > 2) tokens.add(prop[1]!); // skip tiny names like "id"
  }
  return [...tokens];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadIgnoreRules(path: string): { files: string[] } {
  try {
    const rules = { files: [] as string[] };
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const sp = line.indexOf(' ');
      if (sp > 0 && line.slice(0, sp) === 'file') rules.files.push(line.slice(sp + 1).trim());
    }
    return rules;
  } catch {
    return { files: [] };
  }
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  if (glob.includes('**')) return new RegExp(`(^|/)${esc.replace(/\*\*/g, '.*')}`);
  return new RegExp(`(?:^|/)${esc.replace(/\*/g, '[^/]*')}$`);
}

export function scanRepo(rootDir: string, tokens: string[]): UsageHit[] {
  const hits: UsageHit[] = [];
  const matchers = tokens.map((t) => ({
    token: t,
    re: new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(t)}([^A-Za-z0-9_]|$)`),
  }));
  const visit = (d: string, ignoredFiles: RegExp[]): void => {
    // a .sentinelignore in this directory applies to its whole subtree
    const nestedIgnore = join(d, '.sentinelignore');
    const rules = loadIgnoreRules(nestedIgnore);
    const effective = rules.files.length > 0 ? [...ignoredFiles, ...rules.files.map(globToRegExp)] : ignoredFiles;
    for (const entry of readdirSync(d)) {
      if (SKIP.has(entry)) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        visit(full, effective);
        continue;
      }
      const rel = full.slice(rootDir.length + 1);
      if (effective.some((re) => re.test(rel) || re.test(entry))) continue;
      const ext = `.${entry.split('.').pop()}`;
      if (!EXTS.has(ext)) continue;
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const token = matchers.find((m) => m.re.test(line))?.token;
        if (token !== undefined) {
          hits.push({ file: full, line: i + 1, token, snippet: line.trim().slice(0, 120) });
        }
      });
    }
  };
  visit(rootDir, []);
  return hits;
}

export interface TokenRank {
  token: string;
  count: number;
}

/** Count real code usages per token so reports can lead with the biggest blast radius. */
export function rankTokens(rootDir: string, tokens: string[]): TokenRank[] {
  const matchers = tokens.map((t) => ({
    token: t,
    re: new RegExp(`(^|[^A-Za-z0-9_])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`),
  }));
  const counts = new Map<string, number>();
  const visit = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (SKIP.has(entry)) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      const ext = `.${entry.split('.').pop()}`;
      if (!EXTS.has(ext)) continue;
      for (const line of readFileSync(full, 'utf8').split('\n')) {
        for (const m of matchers) {
          if (m.re.test(line)) counts.set(m.token, (counts.get(m.token) ?? 0) + 1);
        }
      }
    }
  };
  visit(rootDir);
  return tokens
    .map((token) => ({ token, count: counts.get(token) ?? 0 }))
    .sort((a, b) => b.count - a.count);
}
