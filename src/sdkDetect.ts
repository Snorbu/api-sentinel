import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Vendor SDK packages we can detect in a consumer's dependencies. */
const SDK_MAP: Record<string, string> = {
  stripe: 'stripe',
  '@stripe/stripe-js': 'stripe',
  openai: 'openai',
  '@anthropic-ai/sdk': 'anthropic',
  '@google-cloud/generative-ai': 'google',
  twilio: 'twilio',
  sendgrid: 'sendgrid',
  '@sendgrid/mail': 'sendgrid',
  slack: 'slack',
  '@slack/web-api': 'slack',
  shopify: 'shopify',
  github: 'github',
  octokit: 'github',
  '@octokit/core': 'github',
  notion: 'notion',
  '@notionhq/client': 'notion',
  airtable: 'airtable',
  'firebase-admin': 'firebase',
};

export interface SdkFinding {
  vendor: string;
  packages: string[];
  advice: string;
}

/**
 * Detect vendor SDKs in a repo's package.json. SDK users get compile-time
 * protection already — tell them so, and point at the watch surface that
 * still matters (the SDK's own release stream).
 */
export function detectSdks(rootDir: string): string[] {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return [];
  }
  const vendors = new Set<string>();
  for (const name of Object.keys(deps)) {
    const vendor = SDK_MAP[name];
    if (vendor) vendors.add(vendor);
  }
  return [...vendors];
}

export function sdkAdvice(vendors: string[]): string {
  if (vendors.length === 0) {
    return 'No vendor SDKs detected — api-sentinel is your only breakage tripwire for raw HTTP calls. Good place to be.';
  }
  return (
    `Vendor SDK(s) detected: ${vendors.join(', ')}. ` +
    'Typed SDKs give you compile-time protection when the vendor ships a new SDK major — ' +
    'still keep api-sentinel on the raw-spec watch: SDK updates lag the spec, and any code ' +
    'bypassing the SDK (scripts, agents, webhooks handlers) is uncovered.'
  );
}
