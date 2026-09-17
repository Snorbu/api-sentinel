export async function fetchSpec(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'api-sentinel/0.1' } });
  if (!res.ok) throw new Error(`spec fetch failed: ${res.status} ${url}`);
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(text) as unknown;
  const { parse } = await import('yaml');
  return parse(text) as unknown;
}
