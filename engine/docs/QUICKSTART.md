# Quickstart - verify the package works on your machine in 5 minutes

Do this first. If these steps pass in a fresh directory, the package is
installed correctly and every other instruction in SKILL.md / VALIDATION.md
applies. If any step fails, the error message names the missing prerequisite.

## Prerequisites

| Tool you want to run | Needs |
|---|---|
| `palette-check.mjs` | Node.js 18 or newer (`node --version`). Nothing else. |
| `validate-page.mjs` | Node.js 18+ and Chrome or Chromium on PATH (`google-chrome`, `chromium`, `chromium-browser`), or set `CHROME_BIN=/path/to/chrome`. No npm install - the CDP driver is dependency-free. |
| `pixel-diff.py` | Python 3.9+ with Pillow (`pip install Pillow`). |

Node-only users can ignore the Python tool; it is optional.

## Smoke test

From the package root (the directory containing SKILL.md):

```bash
# 1. Palette check on the sample A palette (no browser needed)
node tools/palette-check.mjs examples/palette-sample-a.json
# expect: PASS lines for every pair, exit code 0

# 2. Full page validation on the sample hospital page
node tools/validate-page.mjs sample-a-childrens-hospital.html --widths 390,1280
# expect: a JSON report, then a --- summary; exit code 0 means no failures

# 3. Regression tests for the tools themselves
bash tools/tests/run-tests.sh
# expect: "unit tests: 43 passed, 0 failed"
```

Step 2 takes about 3-5 seconds (it launches headless Chrome once).

## What "green" means here

A passing run means the specific checks passed - sampled text contrast pairs,
keyboard reachability with a change-verified focus indicator, an available
font face for each rendered variant's sample text, no horizontal overflow at
the tested widths, a reduced-motion fallback rule present. It is not a WCAG
certification and does not judge whether the design is good. VALIDATION.md
lists exactly what each check proves and does not prove.

## Fresh-directory check (what we ran)

This quickstart was verified by copying the package into an empty directory
and running the three steps above with only the documented prerequisites;
the log is in IMPROVEMENT-LOG.md (cycle 2, re-verified with the current
package in cycle 8 - all three steps green, suite 43/43). Copying the folder
is enough - there is no install step, no build, no network access needed
after download. One suite case (the online control) needs internet and
retries once on transient failure; everything else runs fully offline.
