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
