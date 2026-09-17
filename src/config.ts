import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface ApiEntry {
  name: string; // lowercase slug
  specUrl: string;
}

export interface SentinelConfig {
  apis: ApiEntry[];
}

export function loadConfig(path: string): SentinelConfig {
  if (!existsSync(path)) throw new Error(`config not found: ${path}`);
  const raw = parse(readFileSync(path, 'utf8')) as { apis?: unknown } | null;
  const list = Array.isArray(raw?.apis) ? raw.apis : [];
  const apis: ApiEntry[] = list.map((entry) => {
    const a = entry as { name?: unknown; specUrl?: unknown };
    if (typeof a.name !== 'string' || !/^[a-z0-9-]+$/.test(a.name)) {
      throw new Error(`api.name must be a lowercase slug, got: ${JSON.stringify(a.name)}`);
    }
    if (typeof a.specUrl !== 'string' || !a.specUrl.startsWith('http')) {
      throw new Error(`api[${String(a.name)}].specUrl must be an http(s) URL`);
    }
    return { name: a.name, specUrl: a.specUrl };
  });
  if (apis.length === 0) throw new Error('config must list at least one api');
  return { apis };
}
