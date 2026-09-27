import { classify } from './classify.js';
import { explainChange } from './explain.js';
import type { ChangelogFinding } from './changelog.js';
import type { SpecChange } from './diff.js';
import { usageForPath } from './semantic.js';
import type { UsageHit } from './scan.js';

export interface ReportInput {
  apiName: string;
  specUrl: string;
  fetchedAt: string;
  changes: SpecChange[];
  usages: UsageHit[];
  /** Risky new changelog lines since the last snapshot (informational). */
  changelog?: ChangelogFinding[];
  /** definition path -> endpoints reaching it, for shared-schema changes. */
  refUsage?: Record<string, string[]>;
}

const OP_PREFIX = /^paths\.(\S+?)\.(get|post|put|patch|delete|head|options|trace)\./;

interface ChangeGroup {
  change: SpecChange;
  suffix: string;
  endpoints: string[];
  count: number;
}

/**
 * The same shared response shape reached from six endpoints is ONE break, not
 * six. Group identical changes (same kind, same location within the operation,
 * same before/after) and list the endpoints they hit.
 */
export function groupChanges(changes: SpecChange[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const c of changes) {
    const m = c.path.match(OP_PREFIX);
    const suffix = m ? c.path.slice(m[0].length) : c.path;
    const key = `${c.kind}|${suffix}|${c.before ?? ''}|${c.after ?? ''}`;
    const existing = groups.get(key);
    const endpoint = m ? `${m[2]!.toUpperCase()} ${m[1]!}` : '';
    if (existing === undefined) {
      groups.set(key, { change: c, suffix, endpoints: endpoint ? [endpoint] : [], count: 1 });
    } else {
      existing.count += 1;
      if (endpoint && !existing.endpoints.includes(endpoint)) existing.endpoints.push(endpoint);
    }
  }
  return [...groups.values()];
}

function listEndpoints(eps: string[]): string {
  const shown = eps.slice(0, 5).map((e) => `\`${e}\``).join(', ');
  return `${shown}${eps.length > 5 ? ` (+${eps.length - 5} more)` : ''}`;
}

function affectedEndpoints(path: string, usage: Record<string, string[]>): string {
  const eps = usageForPath(path, usage);
  if (eps.length === 0) return '';
  return `  affects ${eps.length} endpoint${eps.length === 1 ? '' : 's'}: ${listEndpoints(eps)}`;
}

function changelogSection(findings: ChangelogFinding[]): string[] {
  const lines: string[] = ['## Vendor changelog signals (early warning)', ''];
  for (const f of findings) lines.push(`- \`${f.keyword}\` — ${f.line}`);
  lines.push('');
  lines.push('_Informational: changelog prose never changes the exit code._');
  lines.push('');
  return lines;
}

export function buildReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# API Sentinel report — ${input.apiName}`);
  lines.push('');
  lines.push(`- spec: ${input.specUrl}`);
  lines.push(`- fetched at: ${input.fetchedAt}`);
  const breaking = input.changes.filter((c) => classify(c) === 'breaking');
  const additive = input.changes.filter((c) => classify(c) === 'additive');
  const cosmetic = input.changes.filter((c) => classify(c) === 'cosmetic');
  lines.push(`- breaking: ${breaking.length}, additive: ${additive.length}, cosmetic: ${cosmetic.length}`);
  const distinct = groupChanges(breaking).length;
  if (distinct > 0 && distinct < breaking.length) {
    lines.push(`- distinct breaking changes: ${distinct} (the rest are the same break on other endpoints)`);
  }
  lines.push('');
  const findings = input.changelog ?? [];
  if (findings.length > 0) lines.push(`- changelog signals: ${findings.length}`, '');
  if (breaking.length === 0) {
    lines.push('No breaking changes detected. ✅');
    lines.push('');
    if (findings.length > 0) lines.push(...changelogSection(findings));
    return lines.join('\n');
  }
  lines.push('## Breaking changes');
  lines.push('');
  for (const g of groupChanges(breaking)) {
    const c = g.change;
    lines.push(`- \`${c.kind}\` \`${g.endpoints.length > 1 ? g.suffix : c.path}\``);
    const url = c.path.match(OP_PREFIX)?.[1];
    const text = explainChange(c);
    lines.push(
      `  → ${g.endpoints.length > 1 && url ? text.replace(`on \`${url}\``, `on ${g.endpoints.length} endpoints`) : text}`,
    );
    if (g.endpoints.length > 1) {
      lines.push(`  affects ${g.endpoints.length} endpoints: ${listEndpoints(g.endpoints)}`);
    } else {
      const affected = affectedEndpoints(c.path, input.refUsage ?? {});
      if (affected !== '') lines.push(affected);
    }
  }
  lines.push('');
  if (input.usages.length > 0) {
    lines.push('## Possibly affected code in this repo');
    lines.push('');
    for (const u of input.usages) {
      lines.push(`- \`${u.file}:${u.line}\` — token \`${u.token}\` — \`${u.snippet}\``);
    }
    lines.push('');
  }
  if (findings.length > 0) lines.push(...changelogSection(findings));
  return lines.join('\n');
}
