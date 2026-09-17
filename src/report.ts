import { classify } from './classify.js';
import { explainChange } from './explain.js';
import type { SpecChange } from './diff.js';
import type { UsageHit } from './scan.js';

export interface ReportInput {
  apiName: string;
  specUrl: string;
  fetchedAt: string;
  changes: SpecChange[];
  usages: UsageHit[];
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
  if (breaking.length === 0) {
    lines.push('No breaking changes detected. ✅');
    lines.push('');
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
  return lines.join('\n');
}
