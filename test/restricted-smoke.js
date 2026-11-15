'use strict';
// Runtime trust-guard proof: even when the extension is force-activated in an
// untrusted workspace (possible via the dev-host exemption), no entry point
// may spawn Chrome or mutate files.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

async function run() {
  const trusted = vscode.workspace.isTrusted;
  console.log('[restricted] isTrusted:', trusted);
  if (trusted) throw new Error('expected an untrusted workspace for this probe');
  const ext = vscode.extensions.getExtension('samrudh.website-audit-extension');
  const api = await ext.activate(); // dev-host exemption lets this through; guards must hold
  const wsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const motion = path.join(wsDir, 'fixture-motion.html');
  const before = fs.readFileSync(motion, 'utf8');

  const scan = await api.runScan();
  console.log('[restricted] runScan ->', scan);
  const applied = await api.applyFix({ fixable: 'motion-patch', file: motion, rule: 'reduced-motion', id: 'x' });
  console.log('[restricted] applyFix ->', JSON.stringify(applied));
  const reverted = await api.revertFix(motion);
  console.log('[restricted] revertFix ->', JSON.stringify(reverted));
  const preview = await api.previewFix({ fixable: 'motion-patch', file: motion, rule: 'reduced-motion', id: 'y' });
  console.log('[restricted] previewFix ->', JSON.stringify(preview));

  const noSpawn = scan === null && api.getState().current === null;
  const noMutation = fs.readFileSync(motion, 'utf8') === before && !fs.existsSync(motion + '.bak')
    && !fs.existsSync(path.join(wsDir, '.website-audit'));
  const denied = [applied, reverted, preview].every((r) => r && r.error === 'workspace not trusted');
  console.log('[restricted] noSpawn:', noSpawn, 'noMutation:', noMutation, 'deniedWithReason:', denied);
  if (noSpawn && noMutation && denied) console.log('RESTRICTED PASS: runtime guard held under forced activation');
  else throw new Error('runtime trust guard failed');
}
module.exports = { run };
