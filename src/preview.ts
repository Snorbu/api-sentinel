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

/** Markdown -> HTML body fragment (headings, lists, code spans, paragraphs). Pure. */
export function renderReportBody(report: string): string {
  const body: string[] = [];
  let inList = false;
  const closeList = (): void => {
    if (inList) {
      body.push('</ul>');
      inList = false;
    }
  };
  for (const raw of report.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      closeList();
      body.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      body.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (line.startsWith('- ')) {
      if (!inList) {
        body.push('<ul>');
        inList = true;
      }
      body.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line === '') {
      closeList();
    } else {
      closeList();
      body.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return body.join('\n');
}

/** Full dark-theme page with a 5s live-refresh script. Pure. */
export function renderReportHtml(report: string): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>api-sentinel</title>',
    '<style>',
    ':root { color-scheme: dark; }',
    'body { font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #e6edf3; margin: 0; padding: 32px; }',
    'main { max-width: 900px; }',
    'h1 { font-size: 18px; color: #58a6ff; } h2 { font-size: 15px; color: #f0883e; margin-top: 24px; }',
    'code { background: #161b22; border: 1px solid #30363d; border-radius: 4px; padding: 1px 5px; }',
    'ul { padding-left: 20px; } li { margin: 4px 0; }',
    '.meta { color: #8b949e; font-size: 12px; margin-bottom: 16px; }',
    '</style></head>',
    '<body><main id="report">',
    renderReportBody(report),
    '</main>',
    '<script>',
    'setInterval(async () => {',
    '  try {',
    '    const j = await (await fetch("/api/report")).json();',
    '    document.getElementById("report").innerHTML = j.body;',
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
