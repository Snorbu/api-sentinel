/** Curated map: vendor -> public OpenAPI spec URL. Extend freely (PRs welcome). */
export const SPEC_REGISTRY: Record<string, { name: string; specUrl: string }> = {
  stripe: { name: 'stripe', specUrl: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml' },
  openai: { name: 'openai', specUrl: 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml' },
  github: { name: 'github', specUrl: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml' },
  slack: { name: 'slack', specUrl: 'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json' },
  shopify: { name: 'shopify', specUrl: 'https://raw.githubusercontent.com/Shopify/shopify-app-js/main/packages/shopify-api-rest/docs/openapi.json' },
  twilio: { name: 'twilio', specUrl: 'https://raw.githubusercontent.com/twilio/twilio-oai/main/json/twilio_api_v1.json3.json' },
  notion: { name: 'notion', specUrl: 'https://raw.githubusercontent.com/makenotion/notion-sdk-js/main/openapi.json' },
  sendgrid: { name: 'sendgrid', specUrl: 'https://raw.githubusercontent.com/sendgrid/sendgrid-oai/main/oai_total.json' },
  digitalocean: { name: 'digitalocean', specUrl: 'https://raw.githubusercontent.com/digitalocean/openapi/main/specification/api.spaces.yaml' },
};

const SDK_HINTS: Record<string, string> = {
  stripe: 'stripe',
  openai: 'openai',
  '@anthropic-ai/sdk': 'anthropic',
  twilio: 'twilio',
  '@sendgrid/mail': 'sendgrid',
  '@slack/web-api': 'slack',
  '@notionhq/client': 'notion',
  octokit: 'github',
  shopify: 'shopify',
};

export function generateConfig(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const found = new Set<string>();
  for (const dep of Object.keys(deps)) {
    const vendor = SDK_HINTS[dep];
    if (vendor && SPEC_REGISTRY[vendor]) found.add(vendor);
  }
  const lines: string[] = [
    '# api-sentinel config — APIs whose specs you depend on',
    '# add entries for any API you call over raw HTTP',
    'apis:',
  ];
  if (found.size === 0) {
    lines.push('# No vendor APIs detected automatically. Add the ones you call, e.g.:');
    lines.push('#  - name: stripe');
    lines.push('#    specUrl: https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml');
    lines.push('  - name: example');
    lines.push('    specUrl: https://example.com/openapi.yaml');
  } else {
    for (const v of found) {
      lines.push(`  - name: ${SPEC_REGISTRY[v]!.name}`);
      lines.push(`    specUrl: ${SPEC_REGISTRY[v]!.specUrl}`);
    }
  }
  return lines.join('\n') + '\n';
}
