# Website Audit (VS Code extension)

Scan static HTML pages for real accessibility and quality problems, review the
evidence, preview the one automatic fix as a diff, apply it with a backup, and
re-test - all inside VS Code.

**Status: early development.** Verified working in a VS Code 1.112 extension
host on Linux with the bundled audit engine (9/9 host tests pass). Not yet
published to the Marketplace.

## What it checks

Each `.html` page is rendered in a local headless Chrome and checked for:

- **Contrast** - sampled text/background pairs against WCAG ratios
- **Keyboard navigation** - a real Tab sweep: focus visibility, invisible stops, uncovered tabbable elements
- **Fonts** - glyph availability for the font variants the page actually renders
- **Horizontal overflow** - at mobile and desktop widths
- **Reduced motion** - animated elements without a `prefers-reduced-motion` fallback
- **Nav menus** - dropdown/drawer open, focus-in, Escape-close, focus-return probes (only on menus with `[aria-controls]` hooks; anything else goes to the manual review queue)

Scope limits are shown on every finding and in the report: contrast, keyboard
and fonts are audited at the first viewport width (390px by default), overflow
at every width. This is a checker for rendered HTML pages - it does not analyze
React/framework source, server routes, performance, SEO or screen-reader
output, and it never collapses results into a single "quality score".

## How to use it

1. Open a folder containing your HTML pages (trusted workspace - the extension
   is disabled in Restricted Mode because audits launch a local Chrome).
2. Click the Website Audit icon in the activity bar, then **Scan Project**
   (or run `Website Audit: Scan Project` from the command palette).
3. Findings appear in the sidebar and as editor diagnostics, grouped by file,
   each with its check, evidence and scope.
4. For the one auto-fixable finding (missing reduced-motion fallback):
   **Preview Fix** opens a real diff; **Apply Fix** writes the patch and a
   `.bak` backup, then re-scans the file. **Revert Last Fix** restores the
   backup - and refuses if you edited the file after the fix, so your edits
   are never silently discarded.
5. **Re-test** runs the scan again; **Show Before/After Report** compares the
   two scans, lists applied fixes with their backups, and queues everything
   the tools cannot verify as manual review (never as passes).

## Safety behaviors (tested)

- The fix preview never touches the real file; applying after the file changed
  since the preview is refused.
- The fixer refuses to apply while a `.bak` already exists (old backup kept).
- Applying when the finding is already resolved reports "nothing to fix", not success.
- No findings is reported as "automated checks passed", never as certification;
  pages that fail to scan are listed as not checked.

## Privacy and consent

Before the first scan in a workspace, the extension asks for explicit consent
(modal dialog): auditing renders your HTML in a local headless Chrome, so page
JavaScript runs locally. Consent is remembered per workspace and revocable
with `Website Audit: Reset Page-Render Consent`. The extension itself
uploads nothing, but page JavaScript runs and the network restriction below is
best effort, not isolation.

Scans run with a restricted network by default (`websiteAudit.allowNetwork:
false`): external URLs your pages reference (stylesheets, fonts, images,
scripts) are blocked before the page loads, and the page is audited on its
fallback rendering. Anything a blocked request would have provided is listed
for manual review - never silently passed, never failed - and the report says
the fully-resourced page is unverified until you enable `allowNetwork` and
rescan. The restriction is best effort, not isolation (tested: page-JS
fetch/XHR and subresources blocked, main-realm WebSocket/EventSource refused;
known holes: iframes and worker realms - see ENGINE-CONTRACT.md).

The extension declares `untrustedWorkspaces.supported: false`, so in a
Restricted Mode workspace VS Code does not activate it and registers no
commands - no Chrome child process can be launched from an untrusted
workspace. Verified: the declaration (host test) plus a restricted-mode probe
showing the extension starts inactive with no commands registered. Caveat:
automating the full installed-in-Restricted-Mode journey is blocked by VS
Code's Extension Development Host trust exemption (dev-loaded extensions can
be force-activated programmatically); the gate itself is VS Code platform
behavior.

## Requirements

- VS Code 1.90+
- Chrome or Chromium on PATH (or set `CHROME_BIN`)
- The extension runs the bundled engine via Node's child processes; no `npm install` needed at runtime.

## Settings

- `websiteAudit.enginePath` - point at a different engine checkout (must follow `engine/INTEGRATION.md`)
- `websiteAudit.includeGlob` / `websiteAudit.excludeGlob` - which files to scan

## Development

```bash
npm install
xvfb-run -a npm test        # host tests: real VS Code + real engine (9 tests)
bash engine/tools/tests/run-tests.sh   # engine regression suite (29 tests)
```

The audit engine lives in `engine/` (original work, MIT) with its contract in
`engine/INTEGRATION.md` and docs in `engine/docs/`. Any change under
`engine/tools/` must keep its regression suite green.

## License

MIT. See LICENSE.

## Changelog

- **0.1.1** - Fixed: clicking "Apply Fix" on the preview notification did not re-scan the file, so the Findings tree and diagnostics kept showing the fixed issue until you pressed Re-test. All apply/revert paths now re-scan automatically (regression test added). Single-file re-scans after a fix now honor `websiteAudit.allowNetwork` like the full scan does.
- **0.1.0** - First tested prototype.
