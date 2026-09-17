import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPreviousSnapshot, loadSnapshot, saveSnapshot } from '../src/snapshot.js';

describe('snapshot store', () => {
  it('rotates current -> previous on second save', () => {
    const root = mkdtempSync(join(tmpdir(), 'snap-'));
    expect(loadSnapshot(root, 'stripe')).toBeNull();

    saveSnapshot(root, 'stripe', { v: 1 }, '2026-09-17T10:00:00Z');
    expect(loadSnapshot(root, 'stripe')).toEqual({ v: 1 });
    expect(loadPreviousSnapshot(root, 'stripe')).toBeNull();

    saveSnapshot(root, 'stripe', { v: 2 }, '2026-09-17T11:00:00Z');
    expect(loadSnapshot(root, 'stripe')).toEqual({ v: 2 });
    expect(loadPreviousSnapshot(root, 'stripe')).toEqual({ v: 1 });
    expect(existsSync(join(root, 'snapshots', 'stripe', 'meta.json'))).toBe(true);
  });

  it('writes pretty JSON readable by humans', () => {
    const root = mkdtempSync(join(tmpdir(), 'snap-'));
    saveSnapshot(root, 'openai', { a: 1 }, 't');
    const raw = readFileSync(join(root, 'snapshots', 'openai', 'current.json'), 'utf8');
    expect(raw).toContain('\n');
  });
});
