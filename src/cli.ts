import { runCheck } from './commands.js';
import { loadConfig } from './config.js';
import { fetchSpec } from './fetchSpec.js';
import { saveSnapshot } from './snapshot.js';

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

async function runMain(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const cmd = args._[0] ?? '';
  const rootDir = typeof args.root === 'string' ? args.root : process.cwd();

  if (cmd === 'snapshot') {
    const cfg = loadConfig(String(args.config ?? 'apis.yaml'));
    for (const api of cfg.apis) {
      const spec = await fetchSpec(api.specUrl);
      const file = saveSnapshot(rootDir, api.name, spec, new Date().toISOString());
      console.log(`snapshot saved: ${api.name} -> ${file}`);
    }
    return 0;
  }

  if (cmd === 'check') {
    const res = runCheck({
      rootDir,
      repoDir: String(args.repo ?? rootDir),
      configPath: args.config === undefined ? undefined : String(args.config),
      outPath: args.out === undefined ? undefined : String(args.out),
      oldPath: args.old === undefined ? undefined : String(args.old),
      newPath: args.new === undefined ? undefined : String(args.new),
      apiName: args.api === undefined ? undefined : String(args.api),
    });
    if (args.out === undefined) console.log(res.report);
    process.stderr.write(`api-sentinel: exit ${res.exitCode}\n`);
    return res.exitCode;
  }

  console.error(`unknown command: ${cmd}. usage:
  api-sentinel snapshot --config apis.yaml [--root .]
  api-sentinel check    --config apis.yaml --repo ./ [--out report.md]
  api-sentinel check    --old old.json --new new.json --api demo --repo ./ [--out report.md]`);
  return 2;
}

// auto-run when executed directly (tsx src/cli.ts … or node dist/cli.js …)
if (process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
