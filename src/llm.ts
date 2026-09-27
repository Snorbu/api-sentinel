export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

import { fetchWithTimeout } from './http.js';

/** Models think slower than servers respond; give them their own deadline. */
export const LLM_TIMEOUT_MS = 120_000;

export interface ChatOpts {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  messages: ChatMessage[];
}

export async function chatCompletion(opts: ChatOpts, fetchImpl: typeof fetch = fetch): Promise<string> {
  const baseUrl = opts.baseUrl ?? process.env.API_SENTINEL_LLM_BASEURL ?? 'https://api.openai.com/v1';
  const apiKey = opts.apiKey ?? process.env.API_SENTINEL_LLM_KEY;
  const model = opts.model ?? process.env.API_SENTINEL_LLM_MODEL ?? 'gpt-4o-mini';
  if (!apiKey) throw new Error('no API key: set API_SENTINEL_LLM_KEY (or pass apiKey)');

  const res = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: opts.messages }),
      timeout: LLM_TIMEOUT_MS,
      label: 'LLM request',
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${baseUrl}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM response missing choices[0].message.content');
  return content;
}
