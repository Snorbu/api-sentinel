import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function dir(root: string, apiName: string): string {
  return join(root, 'snapshots', apiName);
}

export function saveSnapshot(root: string, apiName: string, spec: unknown, fetchedAt: string): string {
  const d = dir(root, apiName);
  mkdirSync(d, { recursive: true });
  const previous = loadSnapshot(root, apiName);
  if (previous !== null) {
    writeFileSync(join(d, 'previous.json'), JSON.stringify(previous, null, 2));
  }
  writeFileSync(join(d, 'current.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(d, 'meta.json'), JSON.stringify({ fetchedAt }, null, 2));
  return join(d, 'current.json');
}

export function loadSnapshot(root: string, apiName: string): unknown | null {
  const f = join(dir(root, apiName), 'current.json');
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8')) as unknown;
}

export function loadPreviousSnapshot(root: string, apiName: string): unknown | null {
  const f = join(dir(root, apiName), 'previous.json');
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8')) as unknown;
}
