'use strict';
// Thin adapter over the audit engine's stable CLI (see ENGINE-CONTRACT.md /
// engine/INTEGRATION.md). The extension spawns the engine's tools as child
// processes; it never re-implements the checks.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCOPE_LABELS = {
  'validate-page': 'Rendered page audit (Chrome): contrast/keyboard/fonts at first width, overflow at each width',
  'nav-check': 'Nav probes: only menus with [aria-controls] hooks; otherwise manual review',
  'ensure-reduced-motion': 'Static CSS scan for a prefers-reduced-motion fallback',
};

let seq = 0;
function mk(file, tool, rule, severity, message, extra = {}) {
  return {
    id: `${tool}:${rule}:${file}:${seq++}`,
    file, tool, rule, severity, message,
    detail: '', fixable: null, scope: SCOPE_LABELS[tool] || '',
    ...extra,
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e) });
      return;
    }
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function parseValidateJson(stdout) {
  const lines = stdout.split('\n');
  let cut = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '---') { cut = i; break; }
  }
  const jsonText = (cut === -1 ? stdout : lines.slice(0, cut).join('\n')).trim();
  return JSON.parse(jsonText);
}

function stopLabel(st) {
  return `<${st.tag}${st.id ? '#' + st.id : ''}>${st.text ? ` "${st.text}"` : ''}`;
}

function findingsFromValidate(report, file, motionState) {
  const out = [];
  const scope = report.scope || SCOPE_LABELS['validate-page'];
  const c = report.contrast || {};
  for (const f of c.fail || []) {
    out.push(mk(file, 'validate-page', 'contrast', 'error',
      `Low contrast: ${f.label}${f.ratio ? ` - ratio ${f.ratio}, needs ${f.need}` : ''}${f.fg ? ` (fg ${f.fg} on bg ${f.bg})` : ''}`,
      { detail: JSON.stringify(f), scope }));
  }
  for (const u of c.unverifiable || []) {
    out.push(mk(file, 'validate-page', 'contrast', 'manual',
      `Contrast needs a visual check: ${u.label}${u.reason ? ` - ${u.reason}` : ''}`,
      { detail: JSON.stringify(u), scope }));
  }
  const k = report.keyboard || {};
  for (const st of k.stopsWithoutIndicator || []) {
    out.push(mk(file, 'validate-page', 'keyboard-indicator', 'error',
      `Keyboard stop with no visible focus indicator: ${stopLabel(st)}`, { scope }));
  }
  for (const st of k.invisibleStops || []) {
    out.push(mk(file, 'validate-page', 'keyboard-invisible', 'error',
      `Keyboard focus lands on an invisible element: ${stopLabel(st)}`, { scope }));
  }
  for (const st of k.indicatorManualReview || []) {
    out.push(mk(file, 'validate-page', 'keyboard-indicator', 'manual',
      `Focus indicator is a static style; verify it by eye: ${stopLabel(st)}`, { scope }));
  }
  for (const st of k.uncoveredExpected || []) {
    out.push(mk(file, 'validate-page', 'keyboard-coverage', 'warning',
      `Expected tabbable element not reached in the keyboard sweep: ${typeof st === 'string' ? st : stopLabel(st)}`, { scope }));
  }
  if (k.truncated) {
    out.push(mk(file, 'validate-page', 'keyboard-truncated', 'warning',
      `Keyboard sweep truncated (reason: ${k.breakReason}); tab order beyond the cap is unchecked`, { scope }));
  }
  const fo = report.fonts || {};
  for (const p of fo.problems || []) {
    out.push(mk(file, 'validate-page', 'font-glyphs', 'error',
      `Font glyphs unavailable: ${p.renderedVariant}${p.sample ? ` ("${p.sample}")` : ''}`, { scope }));
  }
  for (const p of fo.manualReview || []) {
    out.push(mk(file, 'validate-page', 'font-glyphs', 'manual',
      `Font check unavailable, review by hand: ${p.renderedVariant}`, { scope }));
  }
  for (const o of report.overflow || []) {
    if (o.overflows) {
      out.push(mk(file, 'validate-page', 'overflow', 'error',
        `Horizontal overflow at ${o.width}px viewport (page scrollWidth ${o.scrollWidth})${o.offenders && o.offenders.length ? ` - offenders: ${o.offenders.join(', ')}` : ''}`,
        { scope }));
    }
  }
  const mo = report.motion || {};
  if (mo.fails) {
    if (motionState === 'fixable') {
      out.push(mk(file, 'validate-page', 'reduced-motion', 'error',
        `${mo.animatedElements} animated element(s) but no prefers-reduced-motion fallback. Auto-fixable: review the proposed patch, then apply.`,
        { fixable: 'motion-patch', scope }));
    } else if (motionState === 'external-css') {
      out.push(mk(file, 'validate-page', 'reduced-motion', 'manual',
        `${mo.animatedElements} animated element(s) styled by a linked stylesheet; add a prefers-reduced-motion fallback by hand.`,
        { scope }));
    } else {
      out.push(mk(file, 'validate-page', 'reduced-motion', 'error',
        `${mo.animatedElements} animated element(s) but no prefers-reduced-motion fallback.`, { scope }));
    }
  }
  return out;
}

// Runs all per-page checks on one HTML file. Returns
// { findings, report, error } - error means the page could not be audited.
async function auditFile(enginePath, file, log = () => {}, opts = {}) {
  const toolsDir = path.join(enginePath, 'tools');
  const netFlag = opts.offline === false ? [] : ['--offline'];

  // Motion scan is static (no Chrome) - run first to know fixability.
  const motion = await run(process.execPath, [path.join(toolsDir, 'ensure-reduced-motion.mjs'), file]);
  let motionState = 'none';
  if (motion.code === 1) motionState = 'fixable';
  else if (motion.code === 3) motionState = 'external-css';
  else if (motion.code !== 0) log(`[ensure-reduced-motion] ${file}: exit ${motion.code} ${motion.stderr.trim()}`);

  const vp = await run(process.execPath, [path.join(toolsDir, 'validate-page.mjs'), file, ...netFlag]);
  if (vp.code === -1 || vp.code === 2) {
    return { findings: [], report: null, error: `validate-page could not run: ${(vp.stderr || vp.stdout).trim()}` };
  }
  let report;
  try {
    report = parseValidateJson(vp.stdout);
  } catch (e) {
    return { findings: [], report: null, error: `validate-page output could not be parsed: ${e.message}` };
  }
  const findings = findingsFromValidate(report, file, motionState);

  const nav = await run(process.execPath, [path.join(toolsDir, 'nav-check.mjs'), file, ...netFlag]);
  if (nav.code === 3) {
    findings.push(mk(file, 'nav-check', 'nav-hooks', 'manual',
      'No dropdown/drawer hooks ([aria-controls]) and no sticky/fixed header found. Hand-check: open each menu by keyboard, Tab in, Escape closes, focus returns.',
      { scope: SCOPE_LABELS['nav-check'] }));
  } else if (nav.code === 0 || nav.code === 1) {
    for (const line of nav.stdout.split('\n')) {
      const m = line.match(/^FAIL\s+(.*)$/);
      if (!m) continue;
      // Sticky-header occlusion probes use worst-case scroll-into-view alignment,
      // not real Tab behavior: report as a risk to check, not a proven failure.
      const sticky = /^sticky\/fixed header|^in-page anchor targets/.test(m[1]);
      if (sticky) {
        findings.push(mk(file, 'nav-check', 'sticky-occlusion', 'warning',
          `Risk to verify by hand: ${m[1]}`,
          { scope: 'Sticky/fixed top bars only (not bottom bars or rails). Uses forced start/end scroll alignment - worst case, not actual keyboard focus behavior.' }));
      } else {
        findings.push(mk(file, 'nav-check', 'nav-probe', 'error', `Nav probe failed: ${m[1]}`, { scope: SCOPE_LABELS['nav-check'] }));
      }
    }
  } else {
    log(`[nav-check] ${file}: exit ${nav.code} ${nav.stderr.trim()}`);
  }
  const off = report.offline || { enabled: false };
  const blocked = (off.blockedRequests || []).length;
  if (off.enabled && blocked > 0) {
    findings.push(mk(file, 'validate-page', 'offline-fallback', 'manual',
      `${blocked} external request(s) were blocked by the restricted-network scan. Contrast, keyboard and fonts were audited on the fallback rendering - the fully-resourced page is UNVERIFIED. Enable websiteAudit.allowNetwork and rescan to verify it.`,
      { scope: 'Restricted network is best effort: page-JS fetch/XHR and subresources blocked; main-realm WebSocket/EventSource refused; known holes are iframes and worker realms (documented in ENGINE-CONTRACT).' }));
  }
  return { findings, report, error: null };
}

// Builds the patched content for the reduced-motion fix WITHOUT touching the
// real file: copies to a temp dir and runs the fixer there. Returns
// { patched, reviewText } or { error }.
async function buildMotionPreview(enginePath, file) {
  const review = await run(process.execPath, [path.join(enginePath, 'tools', 'ensure-reduced-motion.mjs'), file]);
  if (review.code !== 1) {
    return { error: `Nothing to fix (fixer exit ${review.code}). ${review.stdout.trim()}` };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-motion-'));
  const tmpFile = path.join(tmpDir, path.basename(file));
  fs.copyFileSync(file, tmpFile);
  const applied = await run(process.execPath, [path.join(enginePath, 'tools', 'ensure-reduced-motion.mjs'), tmpFile, '--apply']);
  if (applied.code !== 0) {
    return { error: `Fixer refused the preview copy: ${(applied.stderr || applied.stdout).trim()}` };
  }
  return { patched: fs.readFileSync(tmpFile, 'utf8'), reviewText: review.stdout.trim() };
}

// Applies the fixer to the real file, honestly. Review mode runs first:
// exit 0 = nothing to fix (NOT a success), exit 1 = finding present, then
// --apply runs. --apply writes <file>.bak and refuses (exit 2) when a .bak
// already exists; that refusal is passed through.
async function applyMotionFix(enginePath, file) {
  const tool = path.join(enginePath, 'tools', 'ensure-reduced-motion.mjs');
  const review = await run(process.execPath, [tool, file]);
  if (review.code === 0) return { nothingToFix: true, message: 'The finding is already resolved in this file.' };
  if (review.code !== 1) return { error: (review.stderr || review.stdout).trim() || `fixer review exit ${review.code}` };
  const res = await run(process.execPath, [tool, file, '--apply']);
  if (res.code === 2) return { refused: true, message: (res.stderr || res.stdout).trim() };
  if (res.code !== 0) return { error: (res.stderr || res.stdout).trim() || `fixer exit ${res.code}` };
  return { ok: true, message: res.stdout.trim() };
}

module.exports = { auditFile, buildMotionPreview, applyMotionFix, parseValidateJson, run };
