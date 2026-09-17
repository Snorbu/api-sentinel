/**
 * Post a breaking-changes alert to a Slack-compatible incoming webhook.
 * Fire-and-forget semantics: returns whether the post succeeded, never throws.
 */
export async function notifyWebhook(
  url: string,
  report: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const m = report.match(/^# API Sentinel report — (.+)$/m);
  const counts = report.match(/- breaking:.*$/m)?.[0] ?? '';
  const summary = `:rotating_light: *API Sentinel* — breaking changes for ${m ? m[1] : 'unknown API'}\n${counts}`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${summary}\n\`\`\`\n${report.slice(0, 2500)}\n\`\`\`` }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
