import { afterEach, describe, expect, it } from 'vitest';
import { chatCompletion } from '../src/llm.js';

const ENV_KEYS = ['API_SENTINEL_LLM_BASEURL', 'API_SENTINEL_LLM_KEY', 'API_SENTINEL_LLM_MODEL'] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('chatCompletion', () => {
  it('posts to baseUrl/chat/completions with bearer auth and returns content', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'PATCH JSON HERE' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = await chatCompletion(
      {
        baseUrl: 'https://llm.example/v1',
        apiKey: 'sk-test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
      },
      fake,
    );
    expect(out).toBe('PATCH JSON HERE');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://llm.example/v1/chat/completions');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('throws with the status code on non-200', async () => {
    const fake = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    await expect(
      chatCompletion(
        { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        fake,
      ),
    ).rejects.toThrow(/503/);
  });

  it('throws a clear error when no API key is configured', async () => {
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      /API_SENTINEL_LLM_KEY/,
    );
  });
});
