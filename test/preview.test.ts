import { describe, expect, it } from 'vitest';
import { renderReportHtml } from '../src/preview.js';

const REPORT = [
  '# API Sentinel report — demo',
  '',
  '- spec: test/fixtures/spec-v1.json → test/fixtures/spec-v2.json',
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
    expect(html).toContain('<h1>API Sentinel report — demo</h1>');
    expect(html).toContain('<h2>Breaking changes</h2>');
    expect(html).toContain('<code>demo/src/payment.ts:5</code>');
    expect(html).toContain('setInterval');
    expect(html).toContain('5000');
    expect(html).toContain('<!doctype html>');
  });

  it('escapes HTML in the report so specs cannot inject markup', () => {
    const html = renderReportHtml('# <script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
