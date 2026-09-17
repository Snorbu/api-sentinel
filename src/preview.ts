import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  // `code` spans -> <code>, everything else escaped
  return s
    .split(/(`[^`]+`)/g)
    .map((p) =>
      p.startsWith('`') && p.endsWith('`') && p.length > 1
        ? `<code>${escapeHtml(p.slice(1, -1))}</code>`
        : escapeHtml(p),
    )
    .join('');
}

function parseCounts(report: string): { breaking: number; additive: number; cosmetic: number } | null {
  const m = report.match(/- breaking:\s*(\d+),\s*additive:\s*(\d+),\s*cosmetic:\s*(\d+)/);
  return m ? { breaking: Number(m[1]), additive: Number(m[2]), cosmetic: Number(m[3]) } : null;
}

function fetchTime(report: string): string | null {
  const m = report.match(/- fetched at:\s*(\S+)/);
  return m ? m[1]! : null;
}

function apiName(report: string): string {
  const m = report.match(/^# API Sentinel report — (.+)$/m);
  return m ? m[1]! : 'unknown';
}

function isErrorReport(report: string): boolean {
  return /^\s*error:\s/m.test(report);
}

function verdictHtml(report: string): string {
  const name = escapeHtml(apiName(report));
  const ts = fetchTime(report);
  const checkedAttr = ts ? escapeHtml(ts) : '';
  const time = ts
    ? escapeHtml(new Date(ts).toLocaleTimeString())
    : new Date().toLocaleTimeString();

  if (isErrorReport(report)) {
    return [
      `<header class="verdict">`,
      `  <div class="who"><h1>${name}</h1><span class="pulse err" aria-hidden="true"></span><span class="pulse-label err">ERROR</span></div>`,
      `</header>`,
      `<section class="error-card"><p><strong>The check failed.</strong> Nothing was broken by a vendor — the sentinel itself couldn't complete its run.</p>`,
      `<p class="mono">${escapeHtml(report.match(/^\s*error:\s*(.+)$/m)?.[1]?.trim() ?? 'unknown error')}</p></section>`,
      `<div class="meta"><span id="checked" data-ts="${checkedAttr}">${time}</span></div>`,
    ].join('\n');
  }

  const counts = parseCounts(report);
  if (!counts) {
    return [
      `<header class="verdict">`,
      `  <div class="who"><h1>${name}</h1><span class="pulse" aria-hidden="true"></span><span class="pulse-label">LIVE</span></div>`,
      `</header>`,
      `<div class="meta"><span id="checked" data-ts="${checkedAttr}">${time}</span></div>`,
    ].join('\n');
  }

  const { breaking, additive, cosmetic } = counts;
  const state = breaking > 0 ? 'bad' : 'ok';
  const stateLabel = breaking > 0 ? 'BREAKING CHANGES' : 'ALL CLEAR';
  const chips = [
    `<span class="chip chip-breaking${breaking === 0 ? ' zero' : ''}"><span>breaking</span><strong>${breaking}</strong></span>`,
    `<span class="chip chip-additive${additive === 0 ? ' zero' : ''}"><span>additive</span><strong>${additive}</strong></span>`,
    `<span class="chip chip-cosmetic${cosmetic === 0 ? ' zero' : ''}"><span>cosmetic</span><strong>${cosmetic}</strong></span>`,
  ].join('\n      ');
  return [
    `<header class="verdict ${state}">`,
    `  <div class="who">`,
    `    <h1>${name}</h1>`,
    `    <span class="pulse" aria-hidden="true"></span><span class="pulse-label">LIVE</span>`,
    `  </div>`,
    `  <p class="state ${state === 'ok' ? 'all-clear' : 'all-broken'}">${
      state === 'ok' ? 'All clear — no breaking changes.' : 'Breaking changes detected in your dependencies.'
    }</p>`,
    `  <div class="chips" role="list" aria-label="change counts">`,
    `      ${chips}`,
    `  </div>`,
    `</header>`,
    `<div class="meta"><span id="checked" data-ts="${checkedAttr}">${time}</span></div>`,
  ].join('\n');
}

/** Markdown -> HTML body fragment (headings, lists, code spans, paragraphs). Pure. */
export function renderReportBody(report: string): string {
  const body: string[] = [];
  let inList = false;
  let inPanel = false;
  let suppressHeading = false;
  const closeList = (): void => {
    if (inList) {
      body.push('</ul>');
      inList = false;
    }
  };
  for (const raw of report.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('# ') || /^- (spec|fetched at|breaking):/.test(line)) {
      closeList();
      suppressHeading = line.startsWith('# ');
      continue; // verdict header replaces h1 + meta lines
    }
    if (line.startsWith('## ')) {
      closeList();
      if (inPanel) {
        body.push('</section>');
        inPanel = false;
      }
      const heading = line.slice(3);
      if (heading === 'Breaking changes') {
        inPanel = true;
        body.push(`<section class="breaking-panel"><h2>${inline(heading)}</h2>`);
      } else {
        body.push(`<h2>${inline(heading)}</h2>`);
      }
    } else if (line.startsWith('- ')) {
      if (!inList) {
        body.push('<ul>');
        inList = true;
      }
      const item = line.slice(2);
      const kindMatch = item.match(/^(`?)(removed|changed|added)\1\s/);
      const badge = kindMatch ? `<span class="kind kind-${kindMatch[2]}">${kindMatch[2]}</span> ` : '';
      const rest = kindMatch ? item.slice(kindMatch[0].length) : item;
      body.push(`<li>${badge}${inline(rest)}</li>`);
    } else if (line === '') {
      closeList();
    } else {
      closeList();
      body.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  if (inPanel) body.push('</section>');
  return verdictHtml(report) + '\n' + body.join('\n');
}

/** Full dark-theme page with a 5s live-refresh script. Pure. */
export function renderReportHtml(report: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>api-sentinel — live report</title>',
    '<style>',
    ':root {',
    '  color-scheme: dark;',
    '  --bg: #0A0E16; --panel: #0F1522; --panel-edge: #1C2636;',
    '  --ink: #DCE3EE; --ink-dim: #8B98AC; --ink-faint: #76839B;',
    '  --red: #FF6B6B; --red-deep: #E5484D;',
    '  --amber: #FFB224; --green: #3DD68C;',
    '}',
    '* { box-sizing: border-box; }',
    'body { background: var(--bg); color: var(--ink); margin: 0; padding: 40px 24px 64px;',
    '  font: 15px/1.6 -apple-system, "SF Pro Text", "Segoe UI", sans-serif; }',
    'main { max-width: 860px; margin: 0 auto; }',
    'h1 { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; margin: 0; }',
    'h2 { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;',
    '  color: var(--ink-dim); margin: 36px 0 12px; }',
    '.mono, code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    '',
    '/* verdict */',
    '.verdict { padding: 8px 0 20px; }',
    '.verdict .who { display: flex; align-items: baseline; gap: 14px; }',
    '.state { margin: 6px 0 18px; font-size: 16px; color: var(--ink-dim); }',
    '.state.all-clear { color: var(--green); }',
    '.state.all-broken { color: var(--red); font-weight: 500; }',
    '.chips { display: flex; gap: 10px; flex-wrap: wrap; }',
    '.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px;',
    '  border: 1px solid var(--panel-edge); border-radius: 8px; background: var(--panel);',
    '  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }',
    '.chip span { color: var(--ink-dim); }',
    '.chip strong { font-size: 15px; }',
    '.chip-breaking strong { color: var(--red); } .chip-breaking { border-color: color-mix(in srgb, var(--red) 35%, transparent); }',
    '.chip-additive strong { color: var(--amber); } .chip-additive { border-color: color-mix(in srgb, var(--amber) 30%, transparent); }',
    '.chip-cosmetic strong { color: var(--ink-faint); } .chip-cosmetic { border-style: dashed; }',
    '.chip.zero { opacity: 0.45; }',
    '',
    '/* pulse */',
    '.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--green); align-self: center;',
    '  animation: pulse 2s ease-in-out infinite; }',
    '.pulse-label { font-size: 10px; letter-spacing: 0.1em; color: var(--green); font-weight: 600; }',
    '.pulse.err { background: var(--red-deep); animation: none; }',
    '.pulse-label.err { color: var(--red-deep); }',
    '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }',
    '@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }',
    '',
    '/* sections */',
    '.breaking-panel { background: var(--panel); border: 1px solid color-mix(in srgb, var(--red) 30%, var(--panel-edge));',
    '  border-left: 3px solid var(--red-deep); border-radius: 10px; padding: 4px 20px 8px; margin: 36px 0 12px; }',
    '.breaking-panel h2 { margin-top: 16px; color: var(--red); }',
    '.breaking-panel li { border-bottom: 1px solid color-mix(in srgb, var(--red) 12%, var(--panel-edge)); }',
    '.breaking-panel li:last-child { border-bottom: none; }',
    'ul { list-style: none; margin: 0; padding: 0; }',
    'li { padding: 9px 0; border-bottom: 1px solid var(--panel-edge); margin: 0; font-size: 13px;',
    '  font-family: ui-monospace, "SF Mono", Menlo, monospace; color: var(--ink-dim); }',
    'li:last-child { border-bottom: none; }',
    '.kind { display: inline-block; min-width: 62px; text-align: center; border-radius: 5px;',
    '  padding: 1px 7px; margin-right: 8px; font-size: 11px; font-weight: 600; }',
    '.kind-removed { color: var(--red); background: color-mix(in srgb, var(--red) 14%, transparent);',
    '  border: 1px solid color-mix(in srgb, var(--red) 35%, transparent); }',
    '.kind-changed { color: var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent);',
    '  border: 1px solid color-mix(in srgb, var(--amber) 30%, transparent); }',
    '.kind-added { color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent);',
    '  border: 1px solid color-mix(in srgb, var(--green) 30%, transparent); }',
    'p { margin: 8px 0; }',
    'code { font-size: 12px; background: transparent; border: none; padding: 0; color: var(--ink); }',
    '.meta { color: var(--ink-faint); font-size: 12px; margin: 4px 0 8px;',
    '  font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    '.error-card { background: var(--panel); border: 1px solid color-mix(in srgb, var(--red) 40%, transparent);',
    '  border-radius: 10px; padding: 16px 20px; }',
    '.error-card p { margin: 4px 0; }',
    '.error-card .mono { color: var(--red); font-size: 13px; }',
    '</style></head>',
    '<body><main id="report" aria-live="polite">',
    renderReportBody(report),
    '</main>',
    '<script>',
    'setInterval(async () => {',
    '  try {',
    '    const j = await (await fetch("/api/report")).json();',
    '    document.getElementById("report").innerHTML = j.body;',
    '    const ts = document.querySelector("#checked")?.getAttribute("data-ts");',
    '    if (ts) document.title = "api-sentinel — " + new Date(ts).toLocaleTimeString();',
    '  } catch (e) { /* server restarting */ }',
    '}, 5000);',
    '</script>',
    '</body></html>',
  ].join('\n');
}

export interface PreviewServer {
  url: string;
  close: () => Promise<void>;
}

export async function startPreviewServer(opts: {
  report: () => string;
  port?: number;
  open?: boolean;
}): Promise<PreviewServer> {
  const port = opts.port ?? 4173;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/report')) {
      const report = opts.report();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ report, body: renderReportBody(report) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderReportHtml(opts.report()));
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}`;

  if (opts.open) {
    try {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    } catch {
      // headless / no browser — ignore
    }
  }

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
