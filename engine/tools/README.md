# Validation companion - runnable checks for the website-design skill

Five small tools that execute the guide's checks against real pages. No npm
dependencies for the Node scripts beyond a Chrome/Chromium binary
(`google-chrome` on PATH, or set `CHROME_BIN`). `pixel-diff.py` needs Python 3
with Pillow. Regression tests for all of them: `bash tools/tests/run-tests.sh`.

## validate-page.mjs

    node tools/validate-page.mjs path/to/page.html [--widths 390,1280] [--max-tab-stops 200] [--offline]

`--offline` isolates the network before first navigation (http/https fetch and
subresources blocked via Network.setBlockedURLs; page-JS WebSocket/EventSource
refused via a new-document script - CDP does not intercept WS handshakes, so
that is the ws mechanism). Blocked resources are MANUAL REVIEW items, never
failures; file:// and data: still load. See INTEGRATION.md for the exact
tested/Not-covered scope.

Runs headless Chrome over the DevTools protocol and reports JSON + a readable
summary; exit code 1 on failures. Checks:

- **contrast** - every visible text element's computed color against its
  composited background up to the root (translucent layers are
  alpha-composited, not treated as opaque), with the WCAG 2.2
  relative-luminance formula. 4.5:1 body, 3:1 large text (24px, or 18.66px
  bold - the WCAG point sizes are authoritative). Situations the formula
  cannot model - images/gradients behind text, ancestor opacity below 1,
  filters, backdrop-filters, blend modes - are reported *unverifiable* for
  manual review, never passed. Runs at the first `--widths` value only.
- **keyboard** - REAL Tab key events (`Input.dispatchKeyEvent`), reading
  `activeElement` at every stop. Elements are tagged with a stable index
  before the walk so duplicated links cannot confuse cycle detection, and
  coverage is compared against the DOM's tabbable elements: an incomplete or
  truncated walk fails. A focus indicator counts as verified only when the
  computed outline/box-shadow actually CHANGED on focus; an unchanged static
  style is listed for manual review. Proves reachability and a changed
  indicator, not that the control then works.
- **fonts** - `FontFaceSet.check()` for every rendered variant (hidden nodes
  excluded) against its rendered sample text, so variable-font ranges and
  system fonts do not false-fail. Proves a matching face is available for the
  sample in this browser - not that every glyph of the page renders with the
  intended face.
- **overflow** - horizontal `scrollWidth` vs viewport at each width, listing
  the widest offending elements. Proves the layout does not force horizontal
  scrolling.
- **reduced motion** - fails when elements animate but no actual
  `@media (prefers-reduced-motion: reduce)` rule exists (a `no-preference`
  query or a bare mention does not count). The rule's presence is not proof
  the motion is calm or that behavior survives near-zero durations; click
  through with reduced motion emulated.

## palette-check.mjs

    node tools/palette-check.mjs palette.json

No browser. Checks text pairs (4.5:1 / 3:1 large), UI pairs (3:1, SC 1.4.11),
and prints the pairwise matrix for a chart color series. Adjacent series colors
under 3:1 are reported `weak`, not failed - WCAG sets no series-pair number;
add a non-color channel (labels, patterns, direct annotation) when weak pairs
sit next to each other.

## pixel-diff.py

    python3 tools/pixel-diff.py approved.png build.png [--tolerance 16] [--out diff.png]

Compares an approved concept screenshot with the build: share of pixels changed
beyond the per-channel tolerance, and the bounding box of the change. A drift
alarm, nothing more: matching pixels do not mean matching quality (rendering
differences move pixels without changing design), and a 100% match says nothing
about whether the design is good. Set the tolerance per project and review the
changed regions by eye. Both images must be the same size - capture at the same
viewport and scale factor.

## nav-check.mjs

    node tools/nav-check.mjs path/to/page.html [--offline]

Interactive probes for dropdowns and drawers found via their `[aria-controls]`
hooks: opens on trigger click, aria-expanded flips, focus moves in on open,
Escape closes, focus returns where it left, and the content behind an open
drawer is unreachable (inert/aria-hidden/hidden). Pages without the hooks get
a MANUAL REVIEW result (exit 3), not a pass or fail.

Sticky/fixed top bars get two occlusion probes that run whether or not the
dropdown/drawer hooks exist: (1) every tabbable element is scrolled to both
the top and bottom viewport edge and must not end up under the bar - this is
a modeled scrollIntoView alignment, not a native Tab walk, so a hit is a
focus-occlusion RISK to confirm by keyboard, not a proven keyboard failure;
and (2) every in-page anchor (`#id`) is clicked via JS with a 150ms settle
wait and its target must land below the bar (instant scroll assumed - a
smooth-scrolling page may need a longer wait). The fix both probes point to
is `scroll-padding-top` (or per-target `scroll-margin-top`). Exit 3 only when
neither hooks nor a sticky bar exist.

## ensure-reduced-motion.mjs

    node tools/ensure-reduced-motion.mjs path/to/page.html [--apply]

Drafts (and with `--apply`, applies) the ONE patch in this package: a marked,
additive `@media (prefers-reduced-motion: reduce)` block. Review mode prints
the exact patch and touches nothing. `--apply` writes a `.bak` first and
REFUSES to run over an existing backup (a stale backup restores the wrong
version). The patch uses `!important` on purpose - it overrides author timing
- and can break behavior that depends on animationend/transitionend or
JS-driven sequences, so a manual click-through with reduced motion emulated
is required after applying. Inline `<style>` only; pages with linked
stylesheets get manual review. Everything beyond this one patch goes through
the review-gated loop in FIX-WORKFLOW.md.

## Honest scope

These tools check mechanics. They cannot judge whether a page is well designed,
whether copy is truthful, or whether an owner will accept a redesign. That
judgment stays with the guide's review steps and the owner's before/after call.
