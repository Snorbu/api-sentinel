import { runCheck, type CheckDeps } from './commands.js';
import { loadConfig } from './config.js';
import { fetchSpec } from './fetchSpec.js';
import { saveSnapshot } from './snapshot.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CliArgs {
  _: string[];
  [flag: string]: string | string[] | undefined;
}

export function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string> = {};
  const valueless = valuelessFlags(argv);
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (valueless.has(key)) {
        flags[key] = 'true';
        continue;
      }
      flags[key] = argv[i + 1]!;
      i++; // consume the value
    } else {
      positional.push(a);
    }
  }
  const out: CliArgs = { _: positional };
  Object.assign(out, flags);
  return out;
}

// A flag is "valueless" when it is the last arg or the next arg is also a flag.
function valuelessFlags(argv: string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) set.add(a.slice(2));
  }
  return set;
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await runMain(argv);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

export function previewCheckDeps(args: CliArgs, rootDir: string): CheckDeps {
  const configPath = args.config === undefined ? undefined : String(args.config);
  if (configPath !== undefined) {
    return { rootDir, repoDir: String(args.repo ?? rootDir), configPath };
  }
  return {
    rootDir,
    repoDir: String(args.repo ?? 'demo'),
    oldPath: String(args.old ?? resolve('test/fixtures/spec-v1.json')),
    newPath: String(args.new ?? resolve('test/fixtures/spec-v2.json')),
    apiName: args.api === undefined || String(args.api) === '' ? 'demo' : String(args.api),
  };
}

async function runMain(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const cmd = args._[0] ?? '';
  const rootDir = typeof args.root === 'string' ? args.root : process.cwd();

  if (cmd === 'snapshot') {
    const cfg = loadConfig(String(args.config ?? 'apis.yaml'));
    const failed: string[] = [];
    for (const api of cfg.apis) {
      try {
        const spec = await fetchSpec(api.specUrl);
        const file = saveSnapshot(rootDir, api.name, spec, new Date().toISOString());
        console.log(`snapshot saved: ${api.name} -> ${file}`);
      } catch (err) {
        failed.push(api.name);
        console.error(`error: ${api.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed.length > 0) {
      console.error(`snapshot failed for ${failed.length}/${cfg.apis.length} API(s): ${failed.join(', ')}`);
      return 1;
    }
    return 0;
  }

  if (cmd === 'check') {
    const failOnRaw = args['fail-on'] === undefined ? undefined : String(args['fail-on']);
    if (failOnRaw !== undefined && !['breaking', 'additive', 'none'].includes(failOnRaw)) {
      console.error('error: --fail-on must be one of: breaking, additive, none');
      return 2;
    }
    const res = runCheck({
      rootDir,
      repoDir: String(args.repo ?? rootDir),
      configPath: args.config === undefined ? undefined : String(args.config),
      outPath: args.out === undefined ? undefined : String(args.out),
      oldPath: args.old === undefined ? undefined : String(args.old),
      newPath: args.new === undefined ? undefined : String(args.new),
      apiName: args.api === undefined || String(args.api) === '' ? undefined : String(args.api),
      failOn: failOnRaw as 'breaking' | 'additive' | 'none' | undefined,
      format: args.format === 'json' ? 'json' : undefined,
    });
    if (args.out === undefined) console.log(res.report);
    if (res.exitCode === 1 && args['notify-webhook'] !== undefined) {
      const { notifyWebhook } = await import('./notify.js');
      const sent = await notifyWebhook(String(args['notify-webhook']), res.report);
      if (sent) console.error('webhook notification sent');
    }
    process.stderr.write(`api-sentinel: exit ${res.exitCode}\n`);
    return res.exitCode;
  }

  if (cmd === 'init') {
    const { generateConfig, SPEC_REGISTRY } = await import('./init.js');
    const { writeFileSync, existsSync } = await import('node:fs');
    const outPath = String(args.out ?? 'apis.yaml');
    if (existsSync(outPath) && args.force === undefined) {
      console.error(`error: ${outPath} already exists (use --force to overwrite)`);
      return 2;
    }
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    } catch {
      // no package.json — skeleton config
    }
    writeFileSync(outPath, generateConfig(pkg));
    console.log(`wrote ${outPath}. Detected registry vendors: ${Object.keys(SPEC_REGISTRY).join(', ')}`);
    console.log('next: npx api-sentinel snapshot --config apis.yaml (twice), then check');
    return 0;
  }

  if (cmd === 'preview') {
    const { startPreviewServer } = await import('./preview.js');
    const baseDeps = previewCheckDeps(args, rootDir);
    const report = (): string => {
      try {
        return runCheck(baseDeps).report;
      } catch (err) {
        return `# API Sentinel report\n\nerror: ${err instanceof Error ? err.message : String(err)}`;
      }
    };
    const server = await startPreviewServer({
      report,
      port: Number(args.port ?? 4173),
      open: args['no-open'] === undefined,
    });
    console.log(`preview: ${server.url}  (Ctrl+C to stop)`);
    await new Promise<void>(() => {}); // keep alive; Ctrl+C exits
  }

  if (cmd === 'fix') {
    const { chatCompletion } = await import('./llm.js');
    const { FIX_SYSTEM_PROMPT } = await import('./fix.js');
    const { runFix } = await import('./fixCommand.js');
    const { reviewPatches } = await import('./review.js');
    const { createInterface } = await import('node:readline/promises');

    const interactive = args['dry-run'] === undefined && args.yes === undefined && process.stdin.isTTY === true;
    const dryRun = args['dry-run'] !== undefined || (!interactive && args.yes === undefined);
    const oldPath = String(args.old ?? resolve('test/fixtures/spec-v1.json'));
    const newPath = String(args.new ?? resolve('test/fixtures/spec-v2.json'));
    const apiName = args.api === undefined || String(args.api) === '' ? 'demo' : String(args.api);
    const repoDir = String(args.repo ?? 'demo');

    const llm = (prompt: string): Promise<string> =>
      chatCompletion({
        messages: [
          { role: 'system', content: FIX_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      });

    // review mode: patches come back unapplied; the dev accepts them one by one
    const res = await runFix({ rootDir, repoDir, oldPath, newPath, apiName, dryRun: true, llm });

    for (const pc of res.perChange) {
      console.log(`\n## ${pc.change.kind} — ${pc.change.path}`);
      for (const u of pc.usages) console.log(`   affected: ${u.file}:${u.line}`);
      for (const p of pc.patches) console.log(`   fix: ${p.explanation}`);
      if (pc.error) console.log(`   error: ${pc.error}`);
    }

    const allPatches = res.perChange.flatMap((pc) => pc.patches);
    let appliedCount = 0;
    let skippedCount = res.skippedCount;

    if (dryRun) {
      appliedCount = res.appliedCount;
      console.log(`\ndry-run: ${appliedCount} patch(es) would apply. Re-run with --yes, or run without flags in a terminal to review each one.`);
    } else if (interactive) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const review = await reviewPatches(repoDir, allPatches, {
        ask: (q) => rl.question(`\n${q}\n> `),
      });
      rl.close();
      appliedCount = review.applied.length;
      skippedCount += review.decisions.filter((d) => d.decision === 'skip').length;
    } else {
      // --yes: non-interactive, trust the validator, write everything
      const { applyFixes } = await import('./applyFix.js');
      const r = applyFixes(repoDir, allPatches, false);
      appliedCount = r.applied.length;
      skippedCount += r.skipped.length;
    }

    console.log(
      `\n${dryRun ? 'would apply' : 'applied'}: ${appliedCount} patch(es)` +
        (skippedCount > 0 ? `, skipped: ${skippedCount}` : ''),
    );
    const unresolved = res.perChange.filter((pc) => pc.patches.length === 0).length;
    return unresolved > 0 ? 1 : 0;
  }

  console.error(`unknown command: ${cmd}. usage:
  api-sentinel init      [--out apis.yaml] [--force]
  api-sentinel snapshot --config apis.yaml [--root .]
  api-sentinel check    --config apis.yaml --repo ./ [--out report.md] [--fail-on breaking|additive|none]
  api-sentinel check    --old old.json --new new.json --api demo --repo ./ [--out report.md] [--fail-on ...]
  api-sentinel preview  [--old o.json --new n.json | --config apis.yaml] [--repo ./] [--port 4173]`);
  return 2;
}

// auto-run when executed directly (tsx src/cli.ts … or node dist/cli.js …)
if (process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
