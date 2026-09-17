import { describe, expect, it } from 'vitest';
import { renderReportHtml } from '../src/preview.js';

const REPORT = [
  '# API Sentinel report — demo',
  '',
  '- spec: test/fixtures/spec-v1.json → test/fixtures/spec-v2.json',
  '- fetched at: 2026-09-17T12:00:00Z',
  '- breaking: 3, additive: 2, cosmetic: 4',
  '',
  '## Breaking changes',
  '',
  '- `removed` `paths./v1/charges.get...properties.paid.type`',
  '',
  '## Possibly affected code in this repo',
  '',
  '- `demo/src/payment.ts:1` — token `/v1/charges` — `const CHARGES_URL = "/v1/charges";`',
  '- `demo/src/payment.ts:5` — token `paid` — `const body = (await res.json()) as { paid: boolean };`',
  '- `demo/src/payment.ts:6` — token `paid` — `return body.paid; // uses the field that gets removed in v2`',
].join('\n');

describe('renderReportHtml', () => {
  it('renders the verdict, panel, counts and auto-refresh script', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('<h1>');
    expect(html).toContain('chip-breaking');
    expect(html).toContain('<h2>Breaking changes <span class="cnt">3</span></h2>');
    expect(html).toContain('class="breaking-panel"');
    expect(html).toContain('setInterval');
    expect(html).toContain('5000');
    expect(html).toContain('<!doctype html>');
  });

  it('escapes HTML in the report so specs cannot inject markup', () => {
    const html = renderReportHtml('## Breaking changes\n\n- `removed` `<script>alert(1)</script>`');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('verdict header', () => {
  it('renders severity chips parsed from the summary line', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('chip-breaking');
    expect(html).toContain('chip-additive');
    expect(html).toContain('chip-cosmetic');
    expect(html).toMatch(/breaking<\/span>\s*<strong>3<\/strong>/);
    expect(html).toMatch(/additive<\/span>\s*<strong>2<\/strong>/);
    expect(html).toMatch(/cosmetic<\/span>\s*<strong>4<\/strong>/);
  });

  it('shows the live pulse with a check timestamp', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('pulse');
    expect(html).toContain('LIVE');
    expect(html).toContain('id="checked"');
  });

  it('renders the all-clear state when there are no breaking changes', () => {
    const ok = REPORT.replace('- breaking: 3, additive: 2, cosmetic: 4', '- breaking: 0, additive: 2, cosmetic: 4');
    const html = renderReportHtml(ok);
    expect(html).toContain('all-clear');
  });

  it('renders an error card for error reports', () => {
    const html = renderReportHtml('# API Sentinel report\n\nerror: spec fetch failed: 500');
    expect(html).toContain('error-card');
  });

  it('anchors a quiet footer outside the live region', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('<footer');
    expect(html).toMatch(/<\/main>\s*<footer/); // footer must survive innerHTML swaps
  });
});

describe('kind badges', () => {
  it('badges the leading kind token and strips it from the text', () => {
    const html = renderReportHtml(
      '## Breaking changes\n\n- `removed` `paths./x.type`\n- `changed` `paths./y.enum`\n',
    );
    expect(html).toContain('<span class="kind kind-removed">removed</span>');
    expect(html).toContain('<span class="kind kind-changed">changed</span>');
    expect(html).not.toContain('>removed</span> <code>removed</code>');
  });
});

describe('affected-code cards', () => {
  it('groups usages by file with line numbers, token chips and highlighted hits', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('file-card');
    expect(html).toContain('<code>demo/src/payment.ts</code>');
    expect(html).toContain('3 hits');
    expect(html).toContain('<span class="ln">5</span>');
    expect(html).toContain('<span class="ln">6</span>');
    expect(html).toContain('<span class="tok">paid</span>');
    expect(html).toContain('<span class="tok">/v1/charges</span>');
    expect(html).toContain('class="hit"');
    expect(html).toContain('<h2>Possibly affected code in this repo <span class="cnt">3</span></h2>');
    expect(html).not.toContain('demo/src/payment.ts:5 — token'); // old flat row format is gone
  });

  it('renders one card per file when multiple files are affected', () => {
    const two = REPORT.replace(
      '- `demo/src/payment.ts:1` — token `/v1/charges` — `const CHARGES_URL = "/v1/charges";`',
      '- `other/src/client.ts:9` — token `/v1/charges` — `fetch("/v1/charges")`',
    );
    const html = renderReportHtml(two);
    expect(html.match(/class="file-card"/g)).toHaveLength(2);
  });
});

describe('page self-healing', () => {
  it('always paints the background at the canvas level and fills the viewport', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toMatch(/html \{[^}]*background/);
    expect(html).toContain('min-height: 100vh');
  });

  it('embeds a version and reloads on version mismatch', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('window.__API_SENTINEL_VERSION');
    expect(html).toContain('location.reload');
  });
});
