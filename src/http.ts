/**
 * Every outbound call goes through here. Unattended CI jobs must never hang on
 * a stalled vendor endpoint, so each request carries a hard deadline and a
 * message that names what timed out.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

export function timeoutMs(fallback = DEFAULT_TIMEOUT_MS): number {
  const raw = process.env.API_SENTINEL_HTTP_TIMEOUT_MS;
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface TimedFetchOpts extends RequestInit {
  /** Hard deadline in ms. Defaults to API_SENTINEL_HTTP_TIMEOUT_MS or 30s. */
  timeout?: number;
  /** Used in the timeout error message, e.g. "spec fetch". */
  label?: string;
}

export async function fetchWithTimeout(
  url: string,
  opts: TimedFetchOpts = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { timeout, label, ...init } = opts;
  const ms = timeout ?? timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label ?? 'request'} timed out after ${ms}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
