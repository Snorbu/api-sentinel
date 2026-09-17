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
  '- `demo/src/payment.ts:5` — token `paid` — `const x = body.paid;`',
].join('\n');

describe('renderReportHtml', () => {
  it('renders headings, lists, code spans and the auto-refresh script', () => {
    const html = renderReportHtml(REPORT);
    expect(html).toContain('<h1>');
    expect(html).toContain('<h2>Breaking changes</h2>');
    expect(html).toContain('<code>demo/src/payment.ts:5</code>');
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
    expect(html).toContain('id="checked"'); // updated per poll
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
});

describe('kind badges', () => {
  it('badges the leading kind token and strips it from the text', () => {
    const html = renderReportHtml(
      '## Breaking changes\n\n- `removed` `paths./x.type`\n- `changed` `paths./y.enum`\n',
    );
    expect(html).toContain('<span class="kind kind-removed">removed</span>');
    expect(html).toContain('<span class="kind kind-changed">changed</span>');
    // original backticked token is not duplicated after the badge
    expect(html).not.toContain('>removed</span> <code>removed</code>');
    expect(html).toContain('class="breaking-panel"');
  });
});
