import type { SpecChange } from './diff.js';

function fieldName(path: string): string {
  // the *deepest* property name is the one that actually changed
  const all = [...path.matchAll(/\.properties\.([A-Za-z0-9_]+)(?:\.|$)/g)];
  const m = all[all.length - 1];
  if (m) return m[1]!;
  const req = path.match(/\.required\.([A-Za-z0-9_]+)$/);
  if (req) return req[1]!;
  return path.split('.').slice(-2, -1)[0] ?? path;
}

function endpoint(path: string): string {
  const m = path.match(/^paths\.(\S+?)\.(get|post|put|patch|delete|head|options)\./);
  return m ? m[1]! : path;
}

function parseJson(s: string | undefined): unknown {
  try {
    return JSON.parse(s ?? '') as unknown;
  } catch {
    return undefined;
  }
}

/**
 * One plain-English sentence for a breaking change: what happened, and what
 * breaks in the consumer. Heuristic leaf paths, human phrasing.
 */
export function explainChange(c: SpecChange): string {
  const field = fieldName(c.path);
  const ep = endpoint(c.path);

  const param = c.path.match(/\.parameters\.([^.:]+):([A-Za-z0-9_-]+)(?:\.|$)/);
  if (param) {
    const [, location, name] = param as unknown as [string, string, string];
    if (c.kind === 'removed') {
      return `${location} parameter \`${name}\` was removed from \`${ep}\` — requests sending it may be rejected.`;
    }
    if (c.kind === 'added' && c.path.endsWith('.required') && c.after === 'true') {
      return `new required ${location} parameter \`${name}\` on \`${ep}\` — requests omitting it will fail.`;
    }
    if (c.kind === 'added') {
      return `new optional ${location} parameter \`${name}\` on \`${ep}\` — safe to ignore.`;
    }
    if (c.path.endsWith('.required')) {
      return c.after === 'true'
        ? `${location} parameter \`${name}\` on \`${ep}\` is now required — requests omitting it will fail.`
        : `${location} parameter \`${name}\` on \`${ep}\` is now optional — no impact.`;
    }
    if (c.path.endsWith('.type')) {
      return `${location} parameter \`${name}\` on \`${ep}\` changed type from ${c.before ?? '?'} to ${c.after ?? '?'}.`;
    }
  }

  if (c.kind === 'removed') {
    if (/\.required\.[^.]+$/.test(c.path)) {
      return `field \`${field}\` stopped being required — calls keep working; you may drop it.`;
    }
    if (/\.description$/.test(c.path)) return `docs for \`${field}\` were removed — no impact.`;
    if (/\.properties\./.test(c.path)) {
      return `response field \`${field}\` was removed on \`${ep}\` — code reading it now gets \`undefined\`.`;
    }
    return `endpoint \`${ep}\` was removed — calls to it will fail.`;
  }

  if (c.kind === 'added') {
    if (/\.required\.[^.]+$/.test(c.path)) {
      return `\`${field}\` is now required on \`${ep}\` — requests missing it will be rejected.`;
    }
    return `new optional field \`${field}\` on \`${ep}\` — safe to ignore.`;
  }

  // changed
  if (c.path.endsWith('.enum')) {
    const before = parseJson(c.before);
    const after = parseJson(c.after);
    if (Array.isArray(before) && Array.isArray(after)) {
      const dropped = before.filter((v) => !after.includes(v));
      if (dropped.length > 0) {
        const list = dropped.map((v) => `\`${String(v)}\``).join(', ');
        return `enum on \`${field}\` no longer includes ${list} — code handling those cases breaks.`;
      }
    }
    return `enum values on \`${field}\` changed.`;
  }
  if (c.path.endsWith('.type')) {
    return `field \`${field}\` changed type from ${c.before ?? '?'} to ${c.after ?? '?'} — parsers expecting the old type break.`;
  }
  return `spec detail on \`${field}\` changed.`;
}
