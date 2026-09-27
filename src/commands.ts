import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeChangelog, loadChangelog, loadPreviousChangelog, type ChangelogFinding } from './changelog.js';
import { classify } from './classify.js';
import { loadConfig } from './config.js';
import { diffSpecs, type SpecChange } from './diff.js';
import { exitCodeFor, type FailOn } from './exitCode.js';
import { filterChanges, filterHits, filterTokens, loadIgnore } from './ignore.js';
import { buildReport } from './report.js';
import { detectSdks, sdkAdvice } from './sdkDetect.js';
import { extractTokens, scanRepo } from './scan.js';
import { definitionUsage } from './semantic.js';
import { loadPreviousSnapshot, loadSnapshot } from './snapshot.js';

export interface CheckDeps {
  rootDir: string;
  repoDir: string;
  configPath?: string;
  outPath?: string;
  oldPath?: string; // fixture/demo mode
  newPath?: string;
  apiName?: string;
  failOn?: FailOn;
  format?: 'text' | 'json';
  /** Treat "no baseline yet" as an error instead of a silent pass. */
  requireBaseline?: boolean;
  /** Also fail when the vendor changelog published new risk language. */
  failOnChangelog?: boolean;
}

export interface CheckResult {
  exitCode: number;
  report: string;
}

export const EXIT_OK = 0;
export const EXIT_CHANGES = 1;
export const EXIT_USAGE = 2;

export function runCheck(deps: CheckDeps): CheckResult {
  const entries: {
    apiName: string;
    specUrl: string;
    oldSpec: unknown;
    newSpec: unknown;
    fetchedAt: string;
    changelog: ChangelogFinding[];
  }[] = [];
  const skips: string[] = [];

  if (deps.oldPath && deps.newPath) {
    entries.push({
      apiName: deps.apiName ?? 'demo',
      specUrl: `${deps.oldPath} → ${deps.newPath}`,
      oldSpec: JSON.parse(readFileSync(deps.oldPath, 'utf8')),
      newSpec: JSON.parse(readFileSync(deps.newPath, 'utf8')),
      fetchedAt: new Date().toISOString(),
      changelog: [],
    });
  } else {
    const cfg = loadConfig(deps.configPath ?? 'apis.yaml');
    for (const api of cfg.apis) {
      const prev = loadPreviousSnapshot(deps.rootDir, api.name);
      const cur = loadSnapshot(deps.rootDir, api.name);
      if (prev === null || cur === null) {
        skips.push(
          `no previous snapshot for ${api.name} — run \`snapshot\` twice, skipping diff` +
            ' (this API is NOT being checked)',
        );
        continue;
      }
      entries.push({
        apiName: api.name,
        specUrl: api.specUrl,
        oldSpec: prev,
        newSpec: cur,
        fetchedAt: new Date().toISOString(),
        changelog: analyzeChangelog(
          loadPreviousChangelog(deps.rootDir, api.name),
          loadChangelog(deps.rootDir, api.name),
        ),
      });
    }
  }

  const sections: string[] = [];
  const jsonApis: {
    apiName: string;
    specUrl: string;
    breaking: number;
    additive: number;
    cosmetic: number;
    changes: SpecChange[];
    usages: { file: string; line: number; token: string; snippet: string }[];
    changelog: ChangelogFinding[];
  }[] = [];
  let anyFailing = false;
  const rules = loadIgnore(deps.repoDir);
  for (const e of entries) {
    const changes: SpecChange[] = filterChanges(diffSpecs(e.oldSpec, e.newSpec), rules);
    const tokens = filterTokens(extractTokens(changes), rules);
    const usages = tokens.length > 0 ? filterHits(scanRepo(deps.repoDir, tokens), rules) : [];
    sections.push(
      buildReport({
        apiName: e.apiName,
        specUrl: e.specUrl,
        fetchedAt: e.fetchedAt,
        changes,
        usages,
        changelog: e.changelog,
        refUsage: definitionUsage(e.newSpec),
      }),
    );
    jsonApis.push({
      apiName: e.apiName,
      specUrl: e.specUrl,
      breaking: changes.filter((c) => classify(c) === 'breaking').length,
      additive: changes.filter((c) => classify(c) === 'additive').length,
      cosmetic: changes.filter((c) => classify(c) === 'cosmetic').length,
      changes,
      usages,
      changelog: e.changelog,
    });
    if (exitCodeFor(changes, deps.failOn ?? 'breaking') === 1) anyFailing = true;
  }

  const parts = [...skips.map((s) => `> ${s}`), ...sections];
  if (entries.length > 0) {
    const vendors = detectSdks(deps.repoDir);
    if (vendors.length > 0) parts.push(`> ${sdkAdvice(vendors)}`);
  }
  if (entries.length === 0 && skips.length === 0) parts.push('> nothing to check: no specs provided');

  const changelogFindings = entries.reduce((n, e) => n + e.changelog.length, 0);
  if ((deps.failOnChangelog ?? false) && changelogFindings > 0) anyFailing = true;
  let missingBaseline = false;
  if ((deps.requireBaseline ?? false) && skips.length > 0) {
    missingBaseline = true;
    parts.push(
      '> `--require-baseline`: refusing to report success while ' +
        `${skips.length} API(s) have no baseline snapshot.`,
    );
  }

  let report: string;
  if (deps.format === 'json') {
    report = JSON.stringify(
      {
        apis: jsonApis,
        skipped: skips.length,
        changelogFindings,
        exitCode: missingBaseline ? EXIT_USAGE : anyFailing ? EXIT_CHANGES : EXIT_OK,
      },
      null,
      2,
    );
  } else {
    report = parts.join('\n\n');
  }
  if (deps.outPath) writeFileSync(deps.outPath, report);
  const exitCode = missingBaseline ? EXIT_USAGE : anyFailing ? EXIT_CHANGES : EXIT_OK;
  return { exitCode, report };
}
