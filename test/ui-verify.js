'use strict';
// Drives the real UI for screenshot capture: apply via the preview-notification code path.
const vscode = require('vscode');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run() {
  const api = await vscode.extensions.getExtension('samrudh.website-audit-extension').activate();
  await sleep(3000);
  await api.grantConsent();
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(ws, 'fixture-motion.html')));
  await vscode.commands.executeCommand('websiteAudit.findings.focus');
  await api.runScan();
  try { await api.revealAll(); } catch {}
  await sleep(6000); // SHOT A: before
  const f = api.getState().current.findings.find((x) => x.fixable === 'motion-patch');
  await api.previewFix(f);
  await sleep(5000);
  await api.acceptPreview(f);
  try { await api.revealAll(); } catch {}
  await sleep(8000); // SHOT B: after apply, no manual retest
}
module.exports = { run };
