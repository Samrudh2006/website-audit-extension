'use strict';
const vscode = require('vscode');
const path = require('path');
const { countBySeverity } = require('./findings');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sevRow(label, key, a, b) {
  const before = a ? a[key] || 0 : '-';
  const after = b ? b[key] || 0 : '-';
  const delta = a && b ? (b[key] || 0) - (a[key] || 0) : null;
  const d = delta === null ? '' : delta < 0 ? ` (${delta})` : delta > 0 ? ` (+${delta})` : ' (0)';
  return `<tr><td>${label}</td><td>${before}</td><td>${after}${d}</td></tr>`;
}

function findingLi(f) {
  return `<li class="${esc(f.severity)}"><span class="sev">${esc(f.severity.toUpperCase())}</span> ${esc(f.message)} <span class="muted">${esc(f.tool)}</span></li>`;
}

// Builds the before/after report HTML from scan state. No single score, no
// certification language: counts, evidence, and explicit scope limits only.
function buildHtml(state) {
  const cur = state.current;
  const prev = state.previous;
  const c = cur ? countBySeverity(cur.findings) : null;
  const p = prev ? countBySeverity(prev.findings) : null;

  const remaining = cur ? cur.findings.filter((f) => f.severity !== 'manual') : [];
  const manual = cur ? cur.findings.filter((f) => f.severity === 'manual') : [];
  const failed = cur ? Object.entries(cur.perFile).filter(([, v]) => v.error) : [];
  const blockedTotal = cur ? Object.values(cur.perFile).reduce((n, v) => n + ((((v.report || {}).offline || {}).blockedRequests) || []).length, 0) : 0;
  const passed = cur ? Object.entries(cur.perFile).filter(([f, v]) => !v.error && !cur.findings.some((x) => x.file === f)) : [];

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 20px 40px; }
h1 { font-size: 1.4em; } h2 { font-size: 1.1em; margin-top: 1.6em; }
table { border-collapse: collapse; } td, th { border: 1px solid var(--vscode-panel-border); padding: 4px 12px; }
.sev { font-weight: 600; font-size: 0.8em; }
li.error .sev { color: var(--vscode-errorForeground); }
li.warning .sev { color: var(--vscode-editorWarning-foreground); }
li.manual .sev { color: var(--vscode-editorInfo-foreground); }
li { margin: 6px 0; } ul { padding-left: 18px; }
.muted { opacity: 0.65; font-size: 0.85em; }
.note { border-left: 3px solid var(--vscode-editorWarning-foreground); padding: 6px 12px; margin: 10px 0; }
code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; }
</style></head><body>
<h1>Website Audit report</h1>
${!cur ? '<p>No scan yet. Run <strong>Website Audit: Scan Project</strong>.</p>' : `
<p class="muted">Latest scan: ${esc(cur.at)}${prev ? ` &middot; previous: ${esc(prev.at)}` : ' (no previous scan to compare yet)'}</p>
${blockedTotal ? `<div class="note">Restricted-network scan (default): ${blockedTotal} external request(s) were blocked. Contrast, keyboard and fonts were audited on the fallback rendering - the fully-resourced page is unverified. Enable <code>websiteAudit.allowNetwork</code> and rescan to verify it.</div>` : ''}

<h2>Findings ${prev ? '(before &rarr; after)' : ''}</h2>
<table><tr><th></th><th>${prev ? 'Before' : 'This scan'}</th>${prev ? '<th>Latest</th>' : ''}</tr>
${prev ? sevRow('Errors', 'error', p, c) + sevRow('Warnings', 'warning', p, c) + sevRow('Manual review', 'manual', p, c)
       : `<tr><td>Errors</td><td>${c.error}</td></tr><tr><td>Warnings</td><td>${c.warning}</td></tr><tr><td>Manual review</td><td>${c.manual}</td></tr>`}
</table>
<p class="muted">Counts only - this extension never collapses results into a single quality score and does not certify a page.</p>

${state.appliedFixes.length ? `<h2>Fixes applied (${state.appliedFixes.length})</h2><ul>
${state.appliedFixes.map((a) => `<li><code>${esc(path.basename(a.file))}</code> - ${esc(a.rule)} at ${esc(a.at)}<br><span class="muted">backup: ${esc(a.backup)} (restore it to revert)</span></li>`).join('')}
</ul><div class="note">Reduced-motion patches use <code>!important</code> by design. Click through each patched page with reduced motion emulated - the re-run proves the rule exists, not that every behavior still works.</div>` : ''}

${remaining.length ? `<h2>Open findings (${remaining.length})</h2><ul>${remaining.map(findingLi).join('')}</ul>` : '<h2>Open findings</h2><p>None from the automated checks on the scanned pages.</p>'}

${manual.length ? `<h2>Manual review queue (${manual.length})</h2>
<p class="muted">The checks cannot verify these automatically. They are not defects and not passes.</p>
<ul>${manual.map(findingLi).join('')}</ul>` : ''}

${passed.length ? `<h2>Pages with no findings</h2><ul>${passed.map(([f]) => `<li><code>${esc(f)}</code> <span class="muted">- automated checks passed; scope limits below still apply</span></li>`).join('')}</ul>` : ''}

${failed.length ? `<h2>Pages that failed to scan (${failed.length})</h2><ul>${failed.map(([f, v]) => `<li class="warning"><span class="sev">SCAN FAILED</span> <code>${esc(f)}</code><br><span class="muted">${esc(v.error)}</span></li>`).join('')}</ul>
<div class="note">Unscanned pages were NOT checked. A common cause is Chrome/Chromium missing - install it or set CHROME_BIN.</div>` : ''}

<h2>What these checks cover</h2>
<ul>
<li>Rendered HTML pages only (Chrome loads each file): contrast, keyboard tab sweep, font glyph availability, horizontal overflow, reduced-motion fallback.</li>
<li>Contrast, keyboard and fonts are audited at the first viewport width (390px by default); overflow is checked at every width.</li>
<li>Nav probes only run on menus using <code>[aria-controls]</code> hooks; anything else lands in the manual review queue.</li>
<li>The only automatic fix is the reduced-motion CSS patch. Brand colors, content, layout and fonts are never auto-rewritten - findings come with evidence and a direction instead.</li>
<li>Not covered: React/framework source semantics, server-rendered routes, performance, SEO, screen-reader output, JS-driven animation behavior.</li>
</ul>`}
</body></html>`;
}

function showReport(context, state) {
  if (state.reportPanel) {
    state.reportPanel.reveal();
    state.reportPanel.webview.html = buildHtml(state);
    return;
  }
  const panel = vscode.window.createWebviewPanel('websiteAuditReport', 'Website Audit Report', vscode.ViewColumn.Beside, {});
  state.reportPanel = panel;
  panel.webview.html = buildHtml(state);
  panel.onDidDispose(() => { state.reportPanel = null; });
}

module.exports = { showReport, buildHtml };
