import { classify } from './classify.js';
import { explainChange } from './explain.js';
import type { ChangelogFinding } from './changelog.js';
import type { SpecChange } from './diff.js';
import type { UsageHit } from './scan.js';

export interface ReportInput {
  apiName: string;
  specUrl: string;
  fetchedAt: string;
  changes: SpecChange[];
  usages: UsageHit[];
  /** Risky new changelog lines since the last snapshot (informational). */
  changelog?: ChangelogFinding[];
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
  for (const c of breaking) {
    lines.push(`- \`${c.kind}\` \`${c.path}\``);
    lines.push(`  → ${explainChange(c)}`);
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
