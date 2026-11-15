# Integration contract - for the VS Code extension builder

Stable CLI surface of the validation engine. Build the extension on top of
these commands as they are; do not rewrite the checks. Everything here is
tested by `bash tools/tests/run-tests.sh` (29 tests, all passing).

## Commands

### 1. Audit - `node tools/validate-page.mjs <page.html> [--widths 390,1280] [--max-tab-stops 200]`
- stdout: JSON report, then a line `---`, then a human summary. Parse the JSON
  up to the LAST `---` line.
- Exit 0 = no failures, 1 = failures, 2 = usage error.
- Needs Chrome/Chromium on PATH or `CHROME_BIN`. ~3-5s per run.
- JSON shape (top level): `page`, `auditedWidth`, `scope`, `contrast`
  (`{checked, pass, fail[], unverifiable[]}`), `keyboard` (`{expectedTabbable,
  tabStops, cycleReached, truncated, breakReason, uncoveredExpected[],
  stopsWithoutIndicator[], indicatorManualReview[], invisibleStops[]}`),
  `fonts` (`{renderedVariants[], problems[], manualReview[], faceCount}`),
  `overflow[]` (per width), `motion` (`{animatedElements, hasReducedMotionRule,
  fails, ...}`), `summary: {failures}`.
- Each contrast finding: `{status, label, ratio?, need?, fg?, bg?, reason?}`.
  `status` is pass | fail | unverifiable (unverifiable = manual review, not a
  pass).
- Limits the extension must surface, not hide: contrast/keyboard/fonts audit
  at the first `--widths` value only; overflow at every width. Unverifiable
  items are not defects and not passes.

### 2. Nav probes - `node tools/nav-check.mjs <page.html>`
- stdout: `PASS`/`FAIL` lines, then `---`, then a count line. (JSON output is
  a reasonable extension-builder addition if needed.)
- Exit 0 = all probes pass, 1 = failures, 3 = no `[aria-controls]` hooks found
  (MANUAL REVIEW - the extension should offer the hand-check guidance, never a
  verdict).

### 3. Palette - `node tools/palette-check.mjs <palette.json>`
- stdout: `PASS`/`FAIL`/`weak` lines. Exit 0 pass, 1 fail, 2 invalid input.
- 8-digit hex composited over the pair bg and noted; malformed hex exits 2.

### 4. One auto-fixable finding - `node tools/ensure-reduced-motion.mjs <page.html> [--apply]`
- Without `--apply`: prints FINDING + exact PROPOSED PATCH + caution, exit 1 if
  unresolved, 0 if nothing to fix, 3 if linked external CSS (manual review).
- With `--apply`: writes `<page>.bak` (REFUSES, exit 2, if a `.bak` already
  exists), inserts the marked block, exit 0, and reminds that a manual
  reduced-motion click-through is required.
- The extension's "apply fix" button should run the review mode first, show
  the printed patch as the diff preview, and only then run `--apply` on
  explicit user approval. The patch is `!important` by design and can break
  animationend/transitionend-dependent behavior - surface that caution.
- Every other finding type (contrast colors, fonts, overflow, keyboard) is
  review-gated: the extension shows evidence + suggested direction; it never
  auto-rewrites brand colors or content.

### 5. Drift (optional, Python) - `python3 tools/pixel-diff.py a.png b.png [--tolerance 16] [--out diff.png]`
- Exit 0 always on success, 1 size mismatch, 2 usage. Per-channel max diff.
  Optional dependency; skip if Python+Pillow absent.

## Extension flow this maps to
scan (1+2) -> findings list with per-check scope labels -> for the one
auto-fixable class, diff preview via review-mode output -> apply on approval
(4) -> re-run (1) -> before/after from the two JSON reports -> manual review
queue for everything unverifiable or review-gated.

## Sample inputs
`sample-a-childrens-hospital.html`, `sample-b-ops-dashboard.html`,
`examples/palette-sample-a.json`, `tools/tests/fixture-*.html` (good/bad nav,
opacity, indicators, motion, dup-logo) - use them as the extension's demo and
test fixtures.

## Hard rules for the builder
- Surface every check's stated scope; never collapse results into a single
  "quality score", never emit an AI-detection or certification claim.
- `run-tests.sh` must keep passing after any change to tools/.
- No network calls from the tools; the extension may add its own but must not
  send user source anywhere without explicit consent.
