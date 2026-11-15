'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const engine = require('./engine');

const MOTION_CAUTION = 'The patch uses !important by design and can break animationend/transitionend-dependent or JS-driven behavior. Click through the page with reduced motion emulated after applying - a green re-run proves the rule exists, not that the page still behaves.';

// Preview copies live in extension-owned storage, never in the user's workspace,
// so an unapplied preview cannot dirty a repo.
function previewDir(context, file) {
  const id = require('crypto').createHash('sha1').update(file).digest('hex').slice(0, 12);
  const dir = path.join(context.globalStorageUri.fsPath, 'preview', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Builds the patched copy, opens a real diff (original <-> patched), and marks
// the finding pending. Never blocks: returns { patched, previewFile } or { error }.
async function previewFix(context, enginePath, finding, state, refresh) {
  if (finding.fixable !== 'motion-patch') {
    vscode.window.showInformationMessage('This finding has no automatic fix. Use the evidence and suggested direction to change it by hand.');
    return { error: 'not fixable' };
  }
  const baseContent = fs.readFileSync(finding.file, 'utf8');
  const built = await engine.buildMotionPreview(enginePath, finding.file);
  if (built.error) {
    vscode.window.showWarningMessage(`Fix preview failed: ${built.error}`);
    return { error: built.error };
  }
  if (built.patched === baseContent) {
    vscode.window.showInformationMessage('The fixer produced no changes for this file.');
    return { error: 'no changes' };
  }
  const previewFile = path.join(previewDir(context, finding.file), path.basename(finding.file) + '.patched');
  fs.writeFileSync(previewFile, built.patched);
  state.pendingPreviews[finding.id] = { baseContent, patched: built.patched, previewFile };
  refresh();
  await vscode.commands.executeCommand('vscode.diff',
    vscode.Uri.file(finding.file), vscode.Uri.file(previewFile),
    `Reduced-motion fix preview - ${path.basename(finding.file)}`, { preview: true });
  vscode.window.showInformationMessage(
    'Fix preview is open in the diff editor. Apply it to the real file? A .bak backup is written first.',
    'Apply Fix', 'Not now'
  ).then((pick) => { if (pick === 'Apply Fix') acceptPreview(context, enginePath, finding, state, refresh); });
  return { patched: built.patched, previewFile, reviewText: built.reviewText };
}

// Entry point for the "Apply Fix" button on the preview notification. It must
// re-scan the file after applying, exactly like the tree's inline Apply button;
// the rescan callback lives on state so no call path can forget it.
function acceptPreview(context, enginePath, finding, state, refresh) {
  return applyFix(context, enginePath, finding, state, refresh, state.rescanFile);
}

// Applies a previewed fix to the real file via the engine's fixer (which
// writes <file>.bak and refuses when a .bak already exists), then re-scans
// that file. Returns { ok, refused, error, backup }.
async function applyFix(context, enginePath, finding, state, refresh, rescanFile) {
  rescanFile = rescanFile || state.rescanFile;
  if (finding.fixable !== 'motion-patch') return { error: 'not fixable' };
  const pending = state.pendingPreviews[finding.id];
  try { fs.rmSync(previewDir(context, finding.file), { recursive: true, force: true }); } catch (e) { /* best effort */ }
  if (pending) {
    const now = fs.readFileSync(finding.file, 'utf8');
    if (now !== pending.baseContent) {
      // The file changed after the preview - never clobber unseen edits.
      delete state.pendingPreviews[finding.id];
      refresh();
      vscode.window.showWarningMessage('The file changed since the fix preview was built. Preview again before applying.');
      return { error: 'file changed since preview' };
    }
  }
  const res = await engine.applyMotionFix(enginePath, finding.file);
  if (res.refused) {
    vscode.window.showWarningMessage(`Fixer refused: ${res.message}`);
    return { refused: true, message: res.message };
  }
  if (res.nothingToFix) {
    vscode.window.showInformationMessage(`Nothing to fix in ${path.basename(finding.file)} - the finding is already resolved there.`);
    return { nothingToFix: true };
  }
  if (res.error) {
    vscode.window.showErrorMessage(`Fix failed: ${res.error}`);
    return { error: res.error };
  }
  const backup = finding.file + '.bak';
  const appliedContent = fs.readFileSync(finding.file, 'utf8');
  state.appliedFixes.push({ file: finding.file, rule: finding.rule, backup, appliedContent, at: new Date().toISOString() });
  delete state.pendingPreviews[finding.id];
  if (pending && pending.previewFile) { try { fs.unlinkSync(pending.previewFile); } catch {} }
  if (typeof rescanFile === 'function') await rescanFile(finding.file);
  refresh();
  vscode.window.showInformationMessage(
    `Fix applied to ${path.basename(finding.file)} (backup: ${path.basename(backup)}). ${MOTION_CAUTION}`,
    'Revert'
  ).then((pick) => { if (pick === 'Revert') revertFix(context, enginePath, finding.file, state, refresh, rescanFile); });
  return { ok: true, backup };
}

// Restores <file> from <file>.bak and removes the .bak so the fixer can run
// again later. If the file changed since the fix was applied, reverting would
// discard those edits: refuse unless force is set (the UI asks explicitly).
async function revertFix(context, enginePath, file, state, refresh, rescanFile, force = false) {
  rescanFile = rescanFile || state.rescanFile;
  const backup = file + '.bak';
  if (!fs.existsSync(backup)) {
    vscode.window.showWarningMessage(`No backup found at ${backup}`);
    return { error: 'no backup' };
  }
  const record = (state.appliedFixes || []).find((a) => a.file === file && a.backup === backup);
  if (!force && record && record.appliedContent !== undefined
      && fs.readFileSync(file, 'utf8') !== record.appliedContent) {
    vscode.window.showWarningMessage(
      `${path.basename(file)} changed after the fix was applied. Reverting would discard those later edits.`,
      { modal: true }, 'Revert Anyway'
    ).then((pick) => {
      if (pick === 'Revert Anyway') revertFix(context, enginePath, file, state, refresh, rescanFile, true);
    });
    return { error: 'file changed since apply' };
  }
  fs.copyFileSync(backup, file);
  fs.unlinkSync(backup);
  state.appliedFixes = state.appliedFixes.filter((a) => !(a.file === file && a.backup === backup));
  state.revertedFixes = state.revertedFixes || [];
  state.revertedFixes.push({ file, at: new Date().toISOString() });
  if (typeof rescanFile === 'function') await rescanFile(file);
  refresh();
  vscode.window.showInformationMessage(`Reverted ${path.basename(file)} from its backup.`);
  return { ok: true };
}

async function applyAllFixes(context, enginePath, state, refresh, rescanFile) {
  const scan = state.current;
  if (!scan) return { error: 'no scan' };
  const fixable = scan.findings.filter((f) => f.fixable);
  if (!fixable.length) {
    vscode.window.showInformationMessage('No auto-fixable findings. Everything else is review-gated by design.');
    return { error: 'none fixable' };
  }
  const pick = await vscode.window.showInformationMessage(
    `Apply ${fixable.length} reduced-motion fix(es)? Each writes a .bak backup first and needs a manual reduced-motion click-through afterwards.`,
    { modal: true }, 'Apply All'
  );
  if (pick !== 'Apply All') return { error: 'cancelled' };
  const results = [];
  for (const f of fixable) {
    results.push({ file: f.file, ...(await applyFix(context, enginePath, f, state, refresh, rescanFile)) });
  }
  return { ok: true, results };
}

module.exports = { previewFix, acceptPreview, applyFix, revertFix, applyAllFixes, MOTION_CAUTION };
