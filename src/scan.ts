import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classify } from './classify.js';
import type { SpecChange } from './diff.js';

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rb', '.php', '.java']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'snapshots']);

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

export function scanRepo(rootDir: string, tokens: string[]): UsageHit[] {
  const hits: UsageHit[] = [];
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
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const token = tokens.find((t) => line.includes(t));
        if (token !== undefined) {
          hits.push({ file: full, line: i + 1, token, snippet: line.trim().slice(0, 120) });
        }
      });
    }
  };
  visit(rootDir);
  return hits;
}
