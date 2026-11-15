'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  // Fresh fixture workspace per run so fix-apply tests start pristine.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-ws-'));
  for (const f of ['fixture-motion.html', 'fixture-nav-bad.html', 'fixture-nav-good.html']) {
    fs.copyFileSync(path.join(root, 'engine', 'tools', 'tests', f), path.join(ws, f));
  }
  console.log('test workspace:', ws);
  await runTests({
    vscodeExecutablePath: '/usr/share/code/code',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
    launchArgs: [ws, '--disable-extensions', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-workspace-trust'],
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
