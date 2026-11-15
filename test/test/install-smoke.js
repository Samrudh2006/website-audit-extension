'use strict';
// Smoke test: the extension INSTALLED from the .vsix (not dev mode) activates
// and a real scan + fix works. Exits nonzero on any failure.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

async function run() {
  console.log('[smoke] trust:', vscode.workspace.isTrusted);
  const ext = vscode.extensions.getExtension('samrudh.website-audit-extension');
  if (!ext) throw new Error('SMOKE FAIL: installed extension not found');
  console.log('[smoke] activating');
  const api = await ext.activate();
  console.log('[smoke] activated');
  if (!api || !api.runScan) throw new Error('SMOKE FAIL: API missing');
  console.log('[smoke] scanning');
  await api.grantConsent();
  const scan = await api.runScan();
  console.log('[smoke] scanned, findings:', scan && scan.findings.length);
  if (!scan || scan.errors.length) throw new Error('SMOKE FAIL: scan errors ' + JSON.stringify(scan && scan.errors));
  const motion = scan.findings.find((f) => f.fixable === 'motion-patch');
  const navFails = scan.findings.filter((f) => f.tool === 'nav-check' && f.severity === 'error');
  if (!motion) throw new Error('SMOKE FAIL: no fixable motion finding');
  if (navFails.length !== 7) throw new Error('SMOKE FAIL: expected 7 nav failures, got ' + navFails.length);
  const applied = await api.applyFix(motion);
  if (!applied.ok) throw new Error('SMOKE FAIL: apply ' + JSON.stringify(applied));
  if (!fs.readFileSync(motion.file, 'utf8').includes('prefers-reduced-motion')) throw new Error('SMOKE FAIL: patch missing');
  if (!fs.existsSync(motion.file + '.bak')) throw new Error('SMOKE FAIL: backup missing');
  const reverted = await api.revertFix(motion.file);
  if (!reverted.ok) throw new Error('SMOKE FAIL: revert ' + JSON.stringify(reverted));
  console.log('SMOKE PASS: installed .vsix scans, fixes, backs up and reverts');
}
module.exports = { run };
