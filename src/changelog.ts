/**
 * v0.3 — per-vendor changelog/docs watching.
 *
 * Specs lag reality: vendors usually announce a deprecation in a changelog or
 * docs page weeks before the OpenAPI document changes. This module snapshots
 * those pages alongside the spec, diffs them between runs, and surfaces the
 * newly-published lines that contain risk language (deprecated, removed,
 * sunset, breaking, …) so you get an early warning, not a postmortem.
 *
 * Findings are informational: they never change the CI exit code, because
 * prose is a heuristic signal, not a contract.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchWithTimeout } from './http.js';
import { join } from 'node:path';

export interface ChangelogFinding {
  line: string;
  keyword: string;
}

const RISK_KEYWORDS = [
  'breaking change',
  'breaking',
  'deprecat', // deprecated / deprecation
  'sunset',
  'end of life',
  'end-of-life',
  'no longer supported',
  'will be removed',
  'has been removed',
  'removal',
  'retire', // retired / retirement
  'migrate',
  'migration',
  'must upgrade',
  'required upgrade',
];

/** Fetch a changelog/docs page as plain text. */
export async function fetchChangelog(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchWithTimeout(
    url,
    { headers: { 'user-agent': 'api-sentinel/0.1' }, label: 'changelog fetch' },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`changelog fetch failed: ${res.status} ${url}`);
  return await res.text();
}

/** Markdown/HTML → comparable lines: tags stripped, entities decoded, blanks dropped. */
export function toLines(text: string): string[] {
  const stripped = /<\/?[a-z][^>]*>/i.test(text)
    ? text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    : text;
  return stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

/** Lines present in `current` that were absent from `previous`, order preserved. */
export function newLines(previous: string, current: string): string[] {
  const before = new Set(toLines(previous));
  const seen = new Set<string>();
  return toLines(current).filter((l) => {
    if (before.has(l) || seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}

/** Newly-published lines that carry deprecation/removal risk language. */
export function riskFindings(lines: string[]): ChangelogFinding[] {
  const out: ChangelogFinding[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const keyword = RISK_KEYWORDS.find((k) => lower.includes(k));
    if (keyword !== undefined) out.push({ line: line.slice(0, 240), keyword });
  }
  return out;
}

/** End-to-end: diff two changelog snapshots and return the risky new lines. */
export function analyzeChangelog(previous: string | null, current: string | null): ChangelogFinding[] {
  if (previous === null || current === null) return [];
  return riskFindings(newLines(previous, current));
}

function dir(root: string, apiName: string): string {
  return join(root, 'snapshots', apiName);
}

/** Save the changelog, rotating current → previous (mirrors spec snapshots). */
export function saveChangelogSnapshot(root: string, apiName: string, text: string): string {
  const d = dir(root, apiName);
  mkdirSync(d, { recursive: true });
  const previous = loadChangelog(root, apiName);
  if (previous !== null) writeFileSync(join(d, 'changelog.previous.txt'), previous);
  const file = join(d, 'changelog.current.txt');
  writeFileSync(file, text);
  return file;
}

export function loadChangelog(root: string, apiName: string): string | null {
  const f = join(dir(root, apiName), 'changelog.current.txt');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

export function loadPreviousChangelog(root: string, apiName: string): string | null {
  const f = join(dir(root, apiName), 'changelog.previous.txt');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}
