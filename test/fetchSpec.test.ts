import { describe, expect, it } from 'vitest';
import { fetchSpec } from '../src/fetchSpec.js';

const fakeFetch = (body: string, status = 200): typeof fetch =>
  ((_url: string | URL) => Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

describe('fetchSpec', () => {
  it('parses JSON specs', async () => {
    const spec = await fetchSpec('https://x/s.json', fakeFetch('{"openapi":"3.0.3"}'));
    expect(spec).toEqual({ openapi: '3.0.3' });
  });

  it('parses YAML specs', async () => {
    const spec = await fetchSpec('https://x/s.yaml', fakeFetch('openapi: 3.0.3\ninfo:\n  title: T\n'));
    expect(spec).toEqual({ openapi: '3.0.3', info: { title: 'T' } });
  });

  it('throws on non-200', async () => {
    await expect(fetchSpec('https://x/s.json', fakeFetch('nope', 500))).rejects.toThrow(/500/);
  });
});
