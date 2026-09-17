import { describe, expect, it } from 'vitest';
import { notifyWebhook } from '../src/notify.js';

describe('notifyWebhook', () => {
  it('posts a Slack-style payload and returns true on 2xx', async () => {
    const calls: { url: string; body: string }[] = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const sent = await notifyWebhook(
      'https://hooks.slack.com/services/X/Y/Z',
      '# API Sentinel report — demo\n\n- breaking: 2, additive: 1, cosmetic: 0',
      fake,
    );
    expect(sent).toBe(true);
    expect(calls[0]!.url).toBe('https://hooks.slack.com/services/X/Y/Z');
    const payload = JSON.parse(calls[0]!.body) as { text: string };
    expect(payload.text).toContain('demo');
    expect(payload.text).toContain('breaking: 2');
  });

  it('returns false on non-2xx without throwing', async () => {
    const fake = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await notifyWebhook('https://x/hook', 'report', fake)).toBe(false);
  });
});
