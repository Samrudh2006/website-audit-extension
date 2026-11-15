#!/usr/bin/env node
// ensure-reduced-motion.mjs - drafts (and on explicit --apply, applies) ONE
// proposed patch: a prefers-reduced-motion fallback block.
//
//   node tools/ensure-reduced-motion.mjs page.html           # review mode: print the exact patch, exit 1 if missing
//   node tools/ensure-reduced-motion.mjs page.html --apply   # apply it, exit 0
//
// SCOPE - read before trusting the output:
// - This is an opt-in patch helper for pages you own, not a universal safe
//   fix. The block uses !important and DOES override author timing rules -
//   that is its purpose. Near-instant transitions can break behavior that
//   depends on animationend/transitionend events, JS-driven sequences, or
//   scroll-linked effects. After --apply you MUST click through the page with
//   reduced motion emulated; a green re-run of validate-page only proves the
//   fallback rule now exists, nothing more.
// - Detection covers INLINE <style> blocks only. If the page links external
//   stylesheets, this tool reports manual review instead of a verdict.
//   JavaScript-driven motion is out of scope entirely.
// - A mention of "prefers-reduced-motion" in a comment, string, or an
//   unrelated media query does NOT count; only an actual
//   `@media (prefers-reduced-motion: reduce)` rule counts. `no-preference`
//   media queries provide no fallback and do not count.
// - Backups: --apply writes page.html.bak and REFUSES to run if that file
//   already exists (a stale backup would restore the wrong version). Move or
//   rename the old backup first.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!file || !existsSync(file)) {
    console.error('Usage: node tools/ensure-reduced-motion.mjs page.html [--apply]');
    process.exit(2);
}
const html = readFileSync(file, 'utf8');

// Inline styles with comments stripped (a comment must never satisfy a check).
const styleBodies = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const css = styleBodies.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const externalCSS = /<link[^>]*rel=["']?stylesheet/i.test(html);

const animates = /\b(?:animation|animation-name|animation-duration|transition|transition-duration|transition-property)\s*:/.test(css);
const hasReduceRule = /@media[^{}]*prefers-reduced-motion\s*:\s*reduce/.test(css);

if (externalCSS) {
    console.log('MANUAL REVIEW: the page links external stylesheets - this tool scans inline <style> only.');
    console.log('Check the linked CSS for animations and a `@media (prefers-reduced-motion: reduce)` fallback by hand.');
    process.exit(3);
}
if (!animates) {
    console.log('no inline CSS animation or transition found - nothing to fix (JS-driven motion is out of scope)');
    process.exit(0);
}
if (hasReduceRule) {
    console.log('an actual `@media (prefers-reduced-motion: reduce)` rule is already present - nothing to fix');
    process.exit(0);
}

const MARK_BEGIN = '/* PATCH proposed by ensure-reduced-motion.mjs - review behavior, delete between the markers to revert */';
const MARK_END = '/* end ensure-reduced-motion patch */';
const BLOCK = `\n${MARK_BEGIN}\n@media (prefers-reduced-motion: reduce) {\n    *, *::before, *::after {\n        animation-duration: .01ms !important;\n        animation-iteration-count: 1 !important;\n        transition-duration: .01ms !important;\n        scroll-behavior: auto !important;\n    }\n}\n${MARK_END}\n`;

console.log('FINDING: inline CSS animates elements but no `@media (prefers-reduced-motion: reduce)` fallback exists.');
console.log('PROPOSED PATCH (appended to the last inline <style>):');
console.log(BLOCK);
console.log('CAUTION: !important intentionally overrides author timing. Behavior depending on');
console.log('animationend/transitionend or JS-driven sequences can break - click through the page');
console.log('with reduced motion emulated after applying. A green re-run proves the rule exists, not');
console.log('that the page still behaves.');

if (!apply) {
    console.log('Review the patch, then rerun with --apply. Exit 1 = finding unresolved.');
    process.exit(1);
}
if (existsSync(file + '.bak')) {
    console.error(`refusing to apply: ${file}.bak already exists (a stale backup restores the wrong version).`);
    console.error('Move or rename the old backup first.');
    process.exit(2);
}
const styleClose = html.lastIndexOf('</style>');
if (styleClose === -1) {
    console.error('cannot apply: no inline <style> block found; add the patch to your stylesheet by hand');
    process.exit(2);
}
copyFileSync(file, file + '.bak');
writeFileSync(file, html.slice(0, styleClose) + BLOCK + html.slice(styleClose));
console.log(`applied. Backup at ${file}.bak - restore it to revert, or delete the marked block.`);
console.log('NOW DO THE MANUAL REVIEW: emulate reduced motion and click through every animated interaction.');
process.exit(0);
