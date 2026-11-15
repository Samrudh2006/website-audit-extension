'use strict';
// Drives the extension UI in a real window for screenshot capture.
// Not part of the test suite; used by the demo-capture script.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (n) => fs.writeFileSync(`/tmp/wa-shot-${n}`, 'ready');

async function run() {
  const ext = vscode.extensions.getExtension('samrudh.website-audit-extension');
  const api = await ext.activate();
  await sleep(4000); // let the window settle
  // First scan WITHOUT consent: the consent modal must appear.
  api.runScan();
  await sleep(4000);
  mark('0-consent-modal');
  await sleep(6000);
  await api.grantConsent();

  const wsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const motion = path.join(wsDir, 'fixture-motion.html');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(motion));
  await api.runScan();
  await sleep(2000);
  mark('1-editor-diagnostics');
  await sleep(5000);

  await vscode.commands.executeCommand('websiteAudit.findings.focus');
  try { await api.revealAll(); } catch (e) { console.log('revealAll failed (non-fatal):', String(e).slice(0, 80)); }
  await sleep(1500);
  mark('2-findings-tree');
  await sleep(5000);

  const scan = api.getState().current;
  const finding = scan.findings.find((f) => f.fixable === 'motion-patch');
  await api.previewFix(finding);
  await sleep(2500);
  mark('3-diff-preview');
  await sleep(5000);

  await api.applyFix(finding);
  await sleep(1500);
  await vscode.commands.executeCommand('website-audit.showReport');
  await sleep(2500);
  mark('4-report');
  await sleep(5000);

  mark('5-done');
}
module.exports = { run };
