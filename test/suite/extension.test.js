'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

suite('Website Audit extension (real host + real engine)', () => {
  let api;
  const wsDir = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
  const motionFile = () => path.join(wsDir(), 'fixture-motion.html');

  suiteSetup(async function () {
    const ext = vscode.extensions.getExtension('samrudh.website-audit-extension');
    assert.ok(ext, 'extension present in host');
    api = await ext.activate();
    assert.ok(api && api.runScan, 'extension API exposed');
  });

  test('scan requires page-render consent (no consent, no Chrome, no findings)', async () => {
    await api.clearConsent();
    assert.strictEqual(api.hasConsent(), false);
    let scan = null, dialogRefused = false;
    try {
      scan = await api.runScan();
    } catch (e) {
      // The test host refuses to show modal dialogs; the throw happens BEFORE
      // any Chrome spawn, which is the property under test.
      dialogRefused = /refused to show dialog/i.test(String(e));
    }
    assert.ok(scan === null || dialogRefused, `no scan without consent (scan=${scan}, dialogRefused=${dialogRefused})`);
    assert.strictEqual(api.getState().current, null, 'no scan state without consent');
    assert.strictEqual(api.hasConsent(), false, 'consent not granted implicitly');
  });

  test('scan produces findings with honest severities across fixtures', async () => {
    await api.grantConsent();
    const scan = await api.runScan();
    assert.ok(scan, 'scan returned');
    assert.strictEqual(scan.errors.length, 0, `no scan failures: ${JSON.stringify(scan.errors)}`);
    assert.ok(Object.keys(scan.perFile).length === 3, 'all 3 fixtures scanned');

    const motion = scan.findings.filter((f) => f.rule === 'reduced-motion');
    assert.ok(motion.length >= 1, 'reduced-motion finding present');
    assert.strictEqual(motion[0].fixable, 'motion-patch', 'motion finding marked auto-fixable');
    assert.strictEqual(motion[0].severity, 'error');

    const navBad = scan.findings.filter((f) => f.file.endsWith('fixture-nav-bad.html') && f.tool === 'nav-check' && f.severity === 'error');
    assert.strictEqual(navBad.length, 7, `7 genuine nav failures on bad fixture, got ${navBad.length}`);
    // Sticky-occlusion probes, when present, are modeled-risk warnings, never errors.
    const sticky = scan.findings.filter((f) => f.rule === 'sticky-occlusion');
    assert.ok(sticky.every((f) => f.severity === 'warning'), 'sticky probes are warnings');

    const navGood = scan.findings.filter((f) => f.file.endsWith('fixture-nav-good.html') && f.tool === 'nav-check');
    assert.strictEqual(navGood.length, 0, 'no nav findings on good fixture');

    // Every finding carries its check scope - no hidden limits.
    assert.ok(scan.findings.every((f) => f.scope && f.scope.length > 10), 'scope labels on all findings');

    // Diagnostics surfaced in the editor.
    const diags = vscode.languages.getDiagnostics().flatMap(([, d]) => d);
    assert.ok(diags.length >= scan.findings.filter((f) => f.severity !== 'manual').length, 'diagnostics published');
  });

  test('motion fix: diff-preview content, guarded apply, backup, rescan clears finding', async () => {
    const scan = api.getState().current;
    const finding = scan.findings.find((f) => f.fixable === 'motion-patch' && f.file === motionFile());
    assert.ok(finding, 'fixable finding on fixture-motion');

    const before = fs.readFileSync(motionFile(), 'utf8');
    assert.ok(!before.includes('prefers-reduced-motion'), 'fixture starts unfixed');

    const preview = await api.previewFix(finding);
    assert.ok(preview.patched, 'preview built');
    assert.ok(preview.patched.includes('@media (prefers-reduced-motion: reduce)'), 'preview contains the patch');
    assert.notStrictEqual(preview.patched, before, 'patch changes content');
    assert.ok(fs.existsSync(preview.previewFile), 'preview file exists for the diff editor');
    assert.strictEqual(fs.readFileSync(motionFile(), 'utf8'), before, 'preview never touches the real file');
    assert.ok(!preview.previewFile.startsWith(path.dirname(motionFile())), 'preview lives in extension storage, not the workspace');
    assert.ok(!fs.existsSync(path.join(path.dirname(motionFile()), '.website-audit')), 'preview does not dirty the workspace');

    const applied = await api.applyFix(finding);
    assert.ok(applied.ok, `apply ok: ${JSON.stringify(applied)}`);
    const after = fs.readFileSync(motionFile(), 'utf8');
    assert.ok(after.includes('@media (prefers-reduced-motion: reduce)'), 'patch applied to real file');
    assert.ok(fs.existsSync(motionFile() + '.bak'), '.bak backup written by the fixer');
    assert.ok(!fs.existsSync(preview.previewFile), 'preview temp file cleaned after apply');
    assert.strictEqual(fs.readFileSync(motionFile() + '.bak', 'utf8'), before, 'backup holds original content');

    // Automatic rescan after apply: motion finding must be gone.
    const cur = api.getState().current;
    assert.ok(!cur.findings.some((f) => f.rule === 'reduced-motion' && f.file === motionFile()), 'motion finding cleared after rescan');
    assert.strictEqual(api.getState().appliedFixes.length, 1, 'applied fix recorded');
  });

  test('fixer refuses to apply while a stale .bak exists', async () => {
    // Real scenario: the user restored the original content but left the .bak
    // behind. The fixer must refuse rather than overwrite the backup.
    fs.copyFileSync(motionFile() + '.bak', motionFile());
    const finding = { fixable: 'motion-patch', file: motionFile(), rule: 'reduced-motion', id: 'synthetic' };
    const res = await api.applyFix(finding);
    assert.ok(res.refused, `refused with stale .bak: ${JSON.stringify(res)}`);
    assert.ok(!fs.readFileSync(motionFile(), 'utf8').includes('prefers-reduced-motion'), 'file untouched on refusal');
    assert.ok(fs.existsSync(motionFile() + '.bak'), 'old backup preserved');
  });

  test('apply on an already-fixed file reports nothing-to-fix, not success', async () => {
    const finding = { fixable: 'motion-patch', file: motionFile(), rule: 'reduced-motion', id: 'synthetic-2' };
    // File currently equals the .bak original (unfixed) after the refusal test;
    // patch it via the tool, then ask the extension to apply again.
    const engine = require('../' + '../src/engine.js');
    const ep = require('path').join(vscode.extensions.getExtension('samrudh.website-audit-extension').extensionPath, 'engine');
    fs.unlinkSync(motionFile() + '.bak');
    const applied = await engine.applyMotionFix(ep, motionFile());
    assert.ok(applied.ok, 'direct tool apply works');
    const res = await api.applyFix(finding);
    assert.ok(res.nothingToFix, `nothing-to-fix reported: ${JSON.stringify(res)}`);
    // End state for the revert test: file patched, .bak holds the original.
  });

  test('revert restores the backup and the finding returns on rescan', async () => {
    const res = await api.revertFix(motionFile());
    assert.ok(res.ok, `reverted: ${JSON.stringify(res)}`);
    assert.ok(!fs.existsSync(motionFile() + '.bak'), '.bak removed after revert');
    assert.ok(!fs.readFileSync(motionFile(), 'utf8').includes('prefers-reduced-motion'), 'original content restored');
    const cur = api.getState().current;
    assert.ok(cur.findings.some((f) => f.rule === 'reduced-motion' && f.file === motionFile()), 'finding back after revert+rescan');
  });

  test('apply refuses when the file changed between preview and apply', async () => {
    // Current state (after revert test): fixture-motion is unfixed, no .bak.
    const finding = api.getState().current.findings.find((f) => f.fixable === 'motion-patch' && f.file === motionFile());
    assert.ok(finding, 'fixable finding present again');
    const preview = await api.previewFix(finding);
    assert.ok(preview.patched, 'preview built');
    // Simulate the user editing the file while the diff is open.
    fs.appendFileSync(motionFile(), '<!-- user edit while preview open -->\n');
    const res = await api.applyFix(finding);
    assert.strictEqual(res.error, 'file changed since preview', `stale preview not applied: ${JSON.stringify(res)}`);
    assert.ok(!fs.readFileSync(motionFile(), 'utf8').includes('prefers-reduced-motion'), 'no patch applied');
    // clean up the synthetic edit for the next test
    const fresh = await api.previewFix(finding); // rebuild preview on edited file
    const applied = await api.applyFix(finding);
    assert.ok(applied.ok, 'fresh preview applies');
    assert.ok(fs.readFileSync(motionFile(), 'utf8').includes('prefers-reduced-motion'));
    assert.ok(fresh.patched.includes('user edit while preview open'), 'user edit preserved through fix');
  });

  test('revert refuses to discard edits made after the fix', async () => {
    // State: fix applied in the previous test, .bak holds the pre-fix file.
    fs.appendFileSync(motionFile(), '<!-- later user edit after apply -->\n');
    const res = await api.revertFix(motionFile());
    assert.strictEqual(res.error, 'file changed since apply', `revert guarded: ${JSON.stringify(res)}`);
    assert.ok(fs.readFileSync(motionFile(), 'utf8').includes('later user edit after apply'), 'later edit intact');
    assert.ok(fs.existsSync(motionFile() + '.bak'), 'backup still present');
    fs.unlinkSync(motionFile() + '.bak'); // leave workspace clean
  });

  test('declares untrusted-workspace gate (no child processes in Restricted Mode)', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscode.extensions.getExtension('samrudh.website-audit-extension').extensionPath, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.capabilities && pkg.capabilities.untrustedWorkspaces && pkg.capabilities.untrustedWorkspaces.supported, false, 'untrustedWorkspaces.supported=false declared');
  });

  test('report is honest: manual review section, scope limits, no score', async () => {
    const html = api.buildReportHtml();
    assert.ok(html.includes('Manual review'), 'manual review section');
    assert.ok(html.includes('never collapses results into a single quality score'), 'no-score statement');
    assert.ok(!/quality score of|score:|% compliant|certified/i.test(html), 'no score/certification language');
    assert.ok(html.includes('What these checks cover'), 'scope section');
  });
});
