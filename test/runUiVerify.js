'use strict';
// Reproducible UI check: opens a real VS Code window on a fresh copy of the motion fixture,
// scans, previews, applies through the preview-notification code path and waits, so you can
// screenshot the Findings tree afterwards (e.g. under xvfb-run with `import -window root`).
// Run: xvfb-run -a -s "-screen 0 1400x900x24" node test/runUiVerify.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');
(async () => {
  const root = path.resolve(__dirname, '..');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ui-'));
  fs.copyFileSync(path.join(root, 'engine', 'tools', 'tests', 'fixture-motion.html'), path.join(ws, 'fixture-motion.html'));
  await runTests({
    vscodeExecutablePath: '/usr/share/code/code',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'suite', 'uiindex'),
    launchArgs: [ws, '--disable-extensions', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-workspace-trust'],
  });
})().catch((e) => { console.error(e); process.exit(1); });
