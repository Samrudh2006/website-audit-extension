'use strict';
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const engine = require('./src/engine');
const { FindingsProvider, publishDiagnostics, countBySeverity } = require('./src/findings');
const fixer = require('./src/fixer');
const reportPanel = require('./src/report');

const state = {
  current: null,      // latest scan { at, findings[], perFile{}, errors[] }
  previous: null,     // scan before it (for before/after)
  appliedFixes: [],
  revertedFixes: [],
  pendingPreviews: {}, // finding.id -> { baseContent, patched, previewFile }
  reportPanel: null,
};

let diagnostics;
let channel;
let provider;
let extensionContext;

function enginePath() {
  const configured = vscode.workspace.getConfiguration('websiteAudit').get('enginePath');
  if (configured && String(configured).trim()) return String(configured).trim();
  return path.join(extensionContext.extensionPath, 'engine');
}

function refreshAll() {
  provider.refresh();
  if (state.current) publishDiagnostics(diagnostics, state.current);
  if (state.reportPanel) state.reportPanel.webview.html = reportPanel.buildHtml(state);
}

// Re-scans a single file in place (after a fix or revert) and merges the
// result into the current scan.
async function rescanFile(file) {
  if (!requireTrust()) return;
  if (!state.current) return;
  const offline = !vscode.workspace.getConfiguration('websiteAudit').get('allowNetwork', false);
  const r = await engine.auditFile(enginePath(), file, (m) => channel.appendLine(m), { offline });
  state.current.findings = state.current.findings.filter((f) => f.file !== file).concat(r.findings);
  state.current.perFile[file] = { report: r.report, error: r.error };
  state.current.at = new Date().toISOString();
  refreshAll();
}

// Runtime trust guard - the manifest capability alone is not enough: a
// dev-loaded extension can be force-activated in Restricted Mode, so every
// entry point that could spawn Chrome or mutate files checks trust itself.
function requireTrust() {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('Website Audit: this workspace is in Restricted Mode. Audits render pages in a local Chrome process, so scanning and fixes stay disabled until you trust this workspace.');
    return false;
  }
  return true;
}

// Inline tree-item buttons pass the TreeItem; palette/automation and
// item.command pass the finding itself. Accept both.
function asFinding(arg) { return arg && arg.finding ? arg.finding : arg; }

async function runScan() {
  if (!requireTrust()) return null;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    vscode.window.showErrorMessage('Website Audit: open a folder containing your HTML pages first.');
    return null;
  }
  // Consent gate: auditing renders workspace HTML in a local headless Chrome.
  // Page JavaScript executes, and external resources the pages reference
  // (fonts, images) are fetched over the network. The tools themselves never
  // send source anywhere. Ask once per workspace; revocable via command.
  if (!extensionContext.workspaceState.get('websiteAudit.pageRenderConsent')) {
    const pick = await vscode.window.showInformationMessage(
      'Website Audit checks pages by rendering them in a local headless Chrome.',
      {
        modal: true,
        detail: 'While auditing, page JavaScript runs locally. By default the network is restricted (best effort): external URLs your pages reference (fonts, images, scripts) are blocked, and the page is audited on its fallback rendering with anything blocked listed for manual review. Set websiteAudit.allowNetwork to true to audit fully-resourced pages. The extension itself uploads nothing, but the page JavaScript runs and this restriction is not isolation: scripts in iframes or workers could still reach the network.\n\nScan this workspace?'
      },
      'Scan This Workspace'
    );
    if (pick !== 'Scan This Workspace') {
      vscode.window.showInformationMessage('Website Audit: scan cancelled - no pages were rendered.');
      return null;
    }
    await extensionContext.workspaceState.update('websiteAudit.pageRenderConsent', true);
  }
  const cfg = vscode.workspace.getConfiguration('websiteAudit');
  const files = await vscode.workspace.findFiles(cfg.get('includeGlob'), cfg.get('excludeGlob'));
  if (!files.length) {
    vscode.window.showInformationMessage(
      'Website Audit: no HTML files matched. The checks run on rendered .html pages; React/framework source files are not scanned directly.'
    );
    return null;
  }
  const eng = enginePath();
  if (!fs.existsSync(path.join(eng, 'tools', 'validate-page.mjs'))) {
    vscode.window.showErrorMessage(`Website Audit: audit engine not found at ${eng}. Set websiteAudit.enginePath.`);
    return null;
  }
  const scan = { at: null, findings: [], perFile: {}, errors: [] };
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Website Audit', cancellable: false },
    async (progress) => {
      for (let i = 0; i < files.length; i++) {
        const f = files[i].fsPath;
        progress.report({ message: `${path.basename(f)} (${i + 1}/${files.length})`, increment: 100 / files.length });
        channel.appendLine(`[scan] ${f}`);
        const offline = !cfg.get('allowNetwork', false);
        const r = await engine.auditFile(eng, f, (m) => channel.appendLine(m), { offline });
        if (r.error) {
          scan.errors.push({ file: f, error: r.error });
          channel.appendLine(`  scan failed: ${r.error}`);
        }
        scan.findings.push(...r.findings);
        scan.perFile[f] = { report: r.report, error: r.error };
      }
    }
  );
  scan.at = new Date().toISOString();
  state.previous = state.current;
  state.current = scan;
  refreshAll();

  const counts = countBySeverity(scan.findings);
  const failedNote = scan.errors.length ? ` ${scan.errors.length} page(s) FAILED to scan and were not checked.` : '';
  if (!scan.findings.length && !scan.errors.length) {
    vscode.window.showInformationMessage(
      `Website Audit: automated checks passed on ${files.length} page(s). This is not a certification - manual review items and scope limits are in the report.`
    );
  } else if (counts.error > 0) {
    vscode.window.showWarningMessage(
      `Website Audit: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.manual} to review by hand across ${files.length} page(s).${failedNote}`
    );
  } else {
    vscode.window.showInformationMessage(
      `Website Audit: no errors. ${counts.warning} warning(s), ${counts.manual} to review by hand across ${files.length} page(s).${failedNote}`
    );
  }
  return scan;
}

async function activate(context) {
  extensionContext = context;
  state.rescanFile = rescanFile;
  channel = vscode.window.createOutputChannel('Website Audit');
  diagnostics = vscode.languages.createDiagnosticCollection('website-audit');
  context.subscriptions.push(diagnostics, channel);

  provider = new FindingsProvider(state);
  const treeView = vscode.window.createTreeView('websiteAudit.findings', { treeDataProvider: provider });
  context.subscriptions.push(treeView);

  const eng = () => enginePath();
  context.subscriptions.push(
    vscode.commands.registerCommand('website-audit.scan', () => runScan()),
    vscode.commands.registerCommand('website-audit.retest', async () => {
      if (!state.current) { vscode.window.showInformationMessage('Run a scan first.'); return; }
      await runScan();
      reportPanel.showReport(context, state);
    }),
    vscode.commands.registerCommand('website-audit.showReport', () => reportPanel.showReport(context, state)),
    vscode.commands.registerCommand('website-audit.openFinding', async (arg) => {
      const finding = asFinding(arg);
      if (!finding) return;
      const doc = await vscode.workspace.openTextDocument(finding.file);
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('website-audit.previewFix', (arg) => {
      const finding = asFinding(arg);
      if (!finding || !requireTrust()) return;
      return fixer.previewFix(context, eng(), finding, state, refreshAll);
    }),
    vscode.commands.registerCommand('website-audit.applyFix', (arg) => {
      const finding = asFinding(arg);
      if (!finding || !requireTrust()) return;
      return fixer.applyFix(context, eng(), finding, state, refreshAll, rescanFile);
    }),
    vscode.commands.registerCommand('website-audit.applyAllFixes', () => {
      if (!requireTrust()) return;
      return fixer.applyAllFixes(context, eng(), state, refreshAll, rescanFile);
    }),
    vscode.commands.registerCommand('website-audit.revertFix', (arg) => {
      const finding = asFinding(arg);
      if (!requireTrust()) return;
      const file = finding && finding.file ? finding.file
        : state.appliedFixes.length ? state.appliedFixes[state.appliedFixes.length - 1].file : null;
      if (!file) { vscode.window.showInformationMessage('Nothing to revert.'); return; }
      return fixer.revertFix(context, eng(), file, state, refreshAll, rescanFile);
    }),
    vscode.commands.registerCommand('website-audit.resetConsent', async () => {
      await extensionContext.workspaceState.update('websiteAudit.pageRenderConsent', undefined);
      vscode.window.showInformationMessage('Website Audit: page-render consent reset. The next scan will ask again.');
    }),
    vscode.commands.registerCommand('website-audit.showGuidance', (arg) => {
      const finding = asFinding(arg);
      if (!finding) return;
      vscode.window.showInformationMessage(`${finding.message}`, { modal: true, detail: `Check: ${finding.tool}\nScope: ${finding.scope}\n\nThis needs a human check - the automated tools cannot verify it. See the report for the full manual review queue.` });
    })
  );

  // Test/automation API - also how the host test-suite drives the extension.
  return {
    grantConsent: () => extensionContext.workspaceState.update('websiteAudit.pageRenderConsent', true),
    clearConsent: () => extensionContext.workspaceState.update('websiteAudit.pageRenderConsent', undefined),
    hasConsent: () => !!extensionContext.workspaceState.get('websiteAudit.pageRenderConsent'),
    revealAll: async () => {
      for (const f of provider.getChildren()) await treeView.reveal(f, { expand: 2, focus: false });
    },
    runScan,
    rescanFile,
    acceptPreview: (finding) => { if (!requireTrust()) return { error: 'workspace not trusted' }; return fixer.acceptPreview(context, eng(), finding, state, refreshAll); },
    getState: () => state,
    previewFix: (finding) => { if (!requireTrust()) return { error: 'workspace not trusted' }; return fixer.previewFix(context, eng(), finding, state, refreshAll); },
    applyFix: (finding) => { if (!requireTrust()) return { error: 'workspace not trusted' }; return fixer.applyFix(context, eng(), finding, state, refreshAll, rescanFile); },
    revertFix: (file) => { if (!requireTrust()) return { error: 'workspace not trusted' }; return fixer.revertFix(context, eng(), file, state, refreshAll, rescanFile); },
    buildReportHtml: () => reportPanel.buildHtml(state),
  };
}

function deactivate() {}

module.exports = { activate, deactivate };
