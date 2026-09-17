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

/** "<code>file:line</code> — token <code>t</code> — <code>snippet</code>" -> structured usage */
interface Affected {
  file: string;
  line: string;
  token: string;
  snippet: string;
}

function parseAffected(li: string): Affected | null {
  const m = li.match(
    /^`(.+):(\d+)`\s+—\s+token\s+`([^`]+)`\s+—\s+`([\s\S]+)`$/,
  );
  return m ? { file: m[1]!, line: m[2]!, token: m[3]!, snippet: m[4]! } : null;
}

function affectedCardHtml(items: string[]): string {
  const parsed = items.map(parseAffected).filter((a): a is Affected => a !== null);
  if (parsed.length === 0) return null as unknown as string;
  const byFile = new Map<string, Affected[]>();
  for (const a of parsed) {
    const list = byFile.get(a.file) ?? [];
    list.push(a);
    byFile.set(a.file, list);
  }
  const cards: string[] = [];
  for (const [file, hits] of byFile) {
    const rows = hits
      .map((h) => {
        const snippet = escapeHtml(h.snippet);
        const idx = snippet.indexOf(escapeHtml(h.token));
        const highlighted =
          idx >= 0
            ? `${snippet.slice(0, idx)}<span class="hit">${escapeHtml(h.token)}</span>${snippet.slice(idx + escapeHtml(h.token).length)}`
            : snippet;
        return [
          '<div class="code-row">',
          `  <span class="ln">${h.line}</span>`,
          `  <span class="tok">${escapeHtml(h.token)}</span>`,
          `  <code class="snippet">${highlighted}</code>`,
          '</div>',
        ].join('\n');
      })
      .join('\n');
    cards.push([
      '<section class="file-card">',
      `  <header><code>${escapeHtml(file)}</code><span class="hits">${hits.length} hit${hits.length === 1 ? '' : 's'}</span></header>`,
      rows,
      '</section>',
    ].join('\n'));
  }
  return cards.join('\n');
}

function verdictHtml(report: string): string {
  const name = escapeHtml(apiName(report));
  const ts = fetchTime(report);
  const checkedAttr = ts ? escapeHtml(ts) : '';
  const time = ts
    ? escapeHtml(new Date(ts).toLocaleTimeString())
    : new Date().toLocaleTimeString();

  const timeRow = `<span class="who-time" id="checked" data-ts="${checkedAttr}">${time}</span>`;
  if (isErrorReport(report)) {
    return [
      `<header class="verdict">`,
      `  <div class="who"><h1>${name}</h1><span class="status"><span class="pulse err" aria-hidden="true"></span><span class="pulse-label err">ERROR</span></span>${timeRow}</div>`,
      `</header>`,
      `<section class="error-card"><p><strong>The check failed.</strong> Nothing was broken by a vendor — the sentinel itself couldn't complete its run.</p>`,
      `<p class="mono">${escapeHtml(report.match(/^\s*error:\s*(.+)$/m)?.[1]?.trim() ?? 'unknown error')}</p></section>`,
    ].join('\n');
  }

  const counts = parseCounts(report);
  if (!counts) {
    return [
      `<header class="verdict">`,
      `  <div class="who"><h1>${name}</h1><span class="status"><span class="pulse" aria-hidden="true"></span><span class="pulse-label">LIVE</span></span>${timeRow}</div>`,
      `</header>`,
    ].join('\n');
  }

  const { breaking, additive, cosmetic } = counts;
  const state = breaking > 0 ? 'bad' : 'ok';
  const chips = [
    `<span class="chip chip-breaking${breaking === 0 ? ' zero' : ''}"><span>breaking</span><strong>${breaking}</strong></span>`,
    `<span class="chip chip-additive${additive === 0 ? ' zero' : ''}"><span>additive</span><strong>${additive}</strong></span>`,
    `<span class="chip chip-cosmetic${cosmetic === 0 ? ' zero' : ''}"><span>cosmetic</span><strong>${cosmetic}</strong></span>`,
  ].join('\n      ');
  return [
    `<header class="verdict ${state}">`,
    `  <div class="who">`,
    `    <h1>${name}</h1>`,
    `    <span class="status"><span class="pulse" aria-hidden="true"></span><span class="pulse-label">LIVE</span></span>`,
    `    ${timeRow}`,
    `  </div>`,
    `  <p class="state ${state === 'ok' ? 'all-clear' : 'all-broken'}">${
      state === 'ok' ? 'All clear — no breaking changes.' : 'Breaking changes detected in your dependencies.'
    }</p>`,
    `  <div class="chips" role="list" aria-label="change counts">`,
    `      ${chips}`,
    `  </div>`,
    `</header>`,
  ].join('\n');
}

/** Markdown -> HTML body fragment (headings, lists, code spans, paragraphs). Pure. */
export function renderReportBody(report: string): string {
  const body: string[] = [];
  let inList = false;
  let inPanel = false;
  let pendingAffected: string[] | null = null;
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
      continue; // verdict header replaces h1 + meta lines
    }
    if (line.startsWith('## ')) {
      closeList();
      if (inPanel) {
        body.push('</section>');
        inPanel = false;
      }
      if (pendingAffected !== null) {
        body.push(affectedCardHtml(pendingAffected) ?? '');
        pendingAffected = null;
      }
      const heading = line.slice(3);
      if (heading === 'Breaking changes') {
        inPanel = true;
        body.push(`<section class="breaking-panel"><h2>${inline(heading)} <span class="cnt">…</span></h2>`);
      } else if (heading === 'Possibly affected code in this repo') {
        pendingAffected = [];
        body.push(`<h2>${inline(heading)} <span class="cnt">…</span></h2>`);
      } else {
        body.push(`<h2>${inline(heading)}</h2>`);
      }
      continue;
    }
    if (line.startsWith('- ')) {
      const item = line.slice(2);
      if (pendingAffected !== null) {
        pendingAffected.push(item);
        continue;
      }
      if (!inList) {
        body.push('<ul>');
        inList = true;
      }
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
  if (pendingAffected !== null) body.push(affectedCardHtml(pendingAffected) ?? '');
  const out = verdictHtml(report) + '\n' + body.join('\n');
  // fill in real counts now that the items are known
  return out
    .replace('<h2>Breaking changes <span class="cnt">…</span></h2>', (m) => {
      const c = parseCounts(report);
      return c ? `<h2>Breaking changes <span class="cnt">${c.breaking}</span></h2>` : m;
    })
    .replace(
      '<h2>Possibly affected code in this repo <span class="cnt">…</span></h2>',
      `<h2>Possibly affected code in this repo <span class="cnt">${(pendingAffectedCount(report))}</span></h2>`,
    );
}

function pendingAffectedCount(report: string): number {
  let n = 0;
  let collecting = false;
  for (const raw of report.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      collecting = line.slice(3) === 'Possibly affected code in this repo';
      continue;
    }
    if (collecting && line.startsWith('- ')) n++;
  }
  return n;
}

/** Bump when the page's structure/CSS changes so open tabs self-heal. */
export const UI_VERSION = '2026-09-17.3';

/** Full dark-theme page with a 5s live-refresh script. Pure. */
export function renderReportHtml(report: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>api-sentinel — live report</title>',
    '<style>',
    'html { background: #0A0E16; min-height: 100%; }',
    ':root {',
    '  color-scheme: dark;',
    '  --bg: #0A0E16; --panel: #0F1522; --panel-edge: #1C2636;',
    '  --ink: #DCE3EE; --ink-dim: #8B98AC; --ink-faint: #76839B;',
    '  --red: #FF6B6B; --red-deep: #E5484D;',
    '  --amber: #FFB224; --green: #3DD68C;',
    '}',
    '* { box-sizing: border-box; }',
    'body { min-height: 100vh; background:',
    '  radial-gradient(1200px 500px at 70% -10%, rgba(107, 169, 242, 0.05), transparent 60%),',
    '  radial-gradient(900px 420px at 15% 0%, rgba(229, 72, 77, 0.04), transparent 55%),',
    '  var(--bg);',
    '  color: var(--ink); margin: 0; padding: 44px 24px 0;',
    '  font: 15px/1.6 -apple-system, "SF Pro Text", "Segoe UI", sans-serif; }',
    'main { max-width: 860px; margin: 0 auto; }',
    'h1 { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; margin: 0; }',
    'h2 { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;',
    '  color: var(--ink-dim); margin: 38px 0 12px; display: flex; align-items: center; gap: 10px; }',
    '.cnt { display: inline-flex; min-width: 20px; justify-content: center; padding: 1px 7px;',
    '  border-radius: 20px; background: var(--panel-edge); color: var(--ink); font-size: 11px; }',
    '.mono, code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    '',
    '/* verdict */',
    '.verdict { padding: 8px 0 20px; }',
    '.verdict .who { display: flex; align-items: center; gap: 18px; }',
    '.verdict .who h1 { margin-right: 4px; }',
    '.status { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px;',
    '  border: 1px solid color-mix(in srgb, var(--green) 30%, transparent); border-radius: 20px;',
    '  background: color-mix(in srgb, var(--green) 8%, transparent); }',
    '.status .pulse-label { font-size: 10px; letter-spacing: 0.08em; }',
    '.who-time { margin-left: auto; color: var(--ink-faint); font-size: 12px;',
    '  font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
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
    '.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--green);',
    '  animation: pulse 2s ease-in-out infinite; }',
    '.pulse-label { font-size: 10px; letter-spacing: 0.1em; color: var(--green); font-weight: 600; }',
    '.pulse.err { background: var(--red-deep); animation: none; }',
    '.pulse-label.err { color: var(--red-deep); }',
    '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }',
    '@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }',
    '',
    '/* sections */',
    '.breaking-panel { background: var(--panel); border: 1px solid color-mix(in srgb, var(--red) 30%, var(--panel-edge));',
    '  border-left: 3px solid var(--red-deep); border-radius: 10px; padding: 4px 20px 8px; }',
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
    '',
    '/* affected-code cards */',
    '.file-card { background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 10px;',
    '  margin: 10px 0 16px; overflow: hidden; }',
    '.file-card header { display: flex; align-items: center; justify-content: space-between;',
    '  padding: 9px 14px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--panel-edge); }',
    '.file-card header code { color: var(--ink); font-size: 12.5px; }',
    '.file-card .hits { color: var(--ink-faint); font-size: 11px;',
    '  font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    '.code-row { display: flex; align-items: baseline; gap: 12px; padding: 8px 14px;',
    '  border-bottom: 1px solid var(--panel-edge); font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    '.code-row:last-child { border-bottom: none; }',
    '.ln { min-width: 28px; text-align: right; color: var(--ink-faint); font-size: 11.5px;',
    '  user-select: none; flex-shrink: 0; }',
    '.tok { color: var(--amber); font-size: 11px; border: 1px solid color-mix(in srgb, var(--amber) 30%, transparent);',
    '  border-radius: 4px; padding: 0 5px; flex-shrink: 0; }',
    '.snippet { font-size: 12.5px; color: var(--ink); overflow-x: auto; white-space: pre; }',
    '.hit { background: color-mix(in srgb, var(--amber) 22%, transparent); border-radius: 3px; }',
    '.code-row:hover { background: rgba(255,255,255,0.02); }',
    '@media (max-width: 640px) { .tok { display: none; } .code-row { flex-wrap: wrap; } }',
    '',
    'p { margin: 8px 0; }',
    'code { font-size: 12px; background: transparent; border: none; padding: 0; color: var(--ink); }',
    '.meta { color: var(--ink-faint); font-size: 12px; margin: 4px 0 8px;',
    '  font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    '.error-card { background: var(--panel); border: 1px solid color-mix(in srgb, var(--red) 40%, transparent);',
    '  border-radius: 10px; padding: 16px 20px; }',
    '.error-card p { margin: 4px 0; }',
    '.error-card .mono { color: var(--red); font-size: 13px; }',
    'footer { max-width: 860px; margin: 56px auto 0; padding: 20px 24px 28px; border-top: 1px solid var(--panel-edge);',
    '  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;',
    '  color: var(--ink-faint); font-size: 11.5px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }',
    'footer .dot { color: var(--green); }',
    '</style></head>',
    '<body><main id="report" aria-live="polite">',
    renderReportBody(report),
    '</main>',
    '<footer>',
    '  <span><span class="dot">●</span> api-sentinel v0.2</span>',
    '  <span>snapshot → diff → classify → scan → fix</span>',
    '  <span>refreshes every 5s</span>',
    '</footer>',
    '<script>',
    'window.__API_SENTINEL_VERSION = "' + UI_VERSION + '";',
    'setInterval(async () => {',
    '  try {',
    '    const j = await (await fetch("/api/report")).json();',
    '    if (j.version !== window.__API_SENTINEL_VERSION) { location.reload(); return; }',
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
      res.end(JSON.stringify({ report, body: renderReportBody(report), version: UI_VERSION }));
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
