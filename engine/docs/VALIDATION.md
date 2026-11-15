# Validation notes - website-visual-theme skill (current state)

Updated November 15, 2026 (third pass): the guide gained an
element-purpose audit (every placement, component, icon, and decorative
element must earn its place; decorative machine-look cliches are cut or
replaced), a clutter-deletion rule (unnecessary cards, empty sections,
and decorative icons - including owner-placed ones - are removed or
simplified, not restyled), logo-preservation guidance (clear space,
consistent sizing, no redesign without owner sign-off), a motion-cost
rule (animate transform and opacity, never on the critical path), a
scrolling rule (purposeful smooth anchor scrolling with sticky-header
offset and focus management; no scroll-jacking; calm under reduced
motion), and a preserve-what-works rule for redesigns of existing sites
(inventory strengths first, remove clutter without flattening
personality, owner before/after acceptance as the validation bar).
These are review-level rules; the two sample pages predate them.

Real-project trial status (honest): the first application of the guide
to a real owner's existing website produced a first iteration the owner
did not accept - it flattened a bold, high-energy site toward generic
minimalism. That failure is the source of the preserve-what-works rule.
The trial continues in iteration; until an owner accepts an applied
result, this guide's breadth is documented coverage, not proven output
quality.

## Guide scope
SKILL.md: audience-first context detection, 2-3 signature palettes with
specific shades and HEX values, on-color pairing, status and
data-visualization color systems, placement-appropriate typography, font
licensing and script coverage (including script line-height), layout,
density, spacing, imagery, components, status indicators, content,
responsive behavior, interactions and motion, cognitive-load budgeting,
anti-slop rules, honest demo labeling, WCAG verification with official
sources, and a finishing layer (icons, 404, social preview).

## Evidence from building and testing two sample pages
(A: children's hospital marketing site, B: warehouse ops dashboard)

- **Contrast:** text/UI pairs computed with the WCAG relative-luminance
  formula; values shown to two decimals, pass/fail judged before rounding
  (4.49:1 still fails 4.5:1). Header demo button verified via rendered
  computed style: rgb(194,74,47) on white, opacity 1, 4.87:1 (AA) - an
  earlier opacity fade had washed it pale; found by pixel check, fixed.
- **Muted-surface pairs:** the muted-pair rule was executed against both
  samples and caught real failures in sample B's status pills: warn text
  was 4.45:1, ok text 4.37:1 on their tints (both fail 4.5:1 body text).
  Fixed to #9A4F04 (5.32:1) and #246B45 (5.58:1). All other pill/KPI
  pairs recomputed and pass (err 5.58:1, neutral 8.20:1, KPI values
  4.70-5.04:1). Sample A needed no change: its muted text never sits on
  the sand band (every usage checked).
- **Fonts:** FontFace-level verification (document.fonts iteration), not
  just document.fonts.check. status=loaded for exactly the rendered
  variants (Baloo 2/700, Nunito/400, IBM Plex Sans/400, IBM Plex
  Mono/400) - network-fetched Google Fonts, not platform fallbacks.
  Unloaded entries are unused unicode-range subsets (normal). Limit:
  proves load in the tested browser; a blocked font network would
  surface as unloaded status, which is the check to run.
- **Keyboard:** real key-event traversal (CDP Input.dispatchKeyEvent
  Tab), reading activeElement and computed outline per stop. Every
  interactive element on both pages reachable with a visible 3px focus
  ring. Not enumeration.
- **Zoom:** 200% evidence is a CSS-zoom approximation on a test copy,
  visually inspected (no overlap/clipping). It is NOT an SC 1.4.4
  conformance proof - a real text-zoom pass needs browser text-zoom
  controls; the guide keeps the SC 1.4.4 requirement with its source.
- **Functionality:** dashboard filters and Resolve exercised end-to-end;
  a filter with zero results shows a visible "No matches..." message in
  every list (was a silent empty table - found by testing, fixed).
  Hospital: working anchor nav, native FAQ accordions, demo controls
  honestly labeled "(demo)", no dead wiring, no plausible live contacts.
- **Visual inspection:** manual inspection at 1440x900 desktop and
  390x844 mobile viewports, kept separate from automated checks. After
  the status-pill patch, sample B was re-rendered headless at 1440px and
  inspected again as pixels: pills readable, dot colors match labels,
  layout unchanged.

## Guide-level rules validated by review
The options-and-recommendation stage (brief sets the option count;
explicit shared criteria; scores labeled as heuristic judgments, never
fabricated votes; one best-fit recommendation with reason, tradeoff, and
one improvement suggestion) and the design-system-informed additions
(on-color pairing, data-viz palettes, status system, script height,
density, cognitive-load heuristics, motion craft) are process rules
validated by review against the cited sources in COMPARISON.md. Except
for the muted-pair contrast rule above, they were not exercised by
rebuilding the sample pages.

## Limits
- Two single-page samples with fictional content and inline SVG; they
  demonstrate the guide's decisions, they do not prove production
  outcomes across a full site.
- Source comparison is a bounded sample of public material; no
  "best in market" or complete-coverage claim, and no accessibility
  certification.
- Contrast numbers are formula computations on the shipped CSS values
  plus rendered screenshot inspections; interaction evidence (keyboard,
  fonts, filters) predates the two-value pill color patch, which does
  not affect it.

## Runnable companion results (November 15, cycle 0)

The guide now ships a validation companion (`tools/`, see its README for
scope and limitations). Verified by real runs in this sandbox:

- `validate-page.mjs` on sample A: caught footer fine print at 4.06:1
  (needs 4.5:1). Fixed #A9C6C1 -> #C4DAD5 (5.05:1, computed by
  palette-check). Re-run (stricter cycle-1 tools): 66/66 sampled text pairs pass contrast,
  keyboard covers all 14 tabbable elements (15 stops, cycle completed,
  every indicator change-verified), 19 rendered font variants have an
  available matching face for their sample text (availability, not
  proof the primary face renders every glyph), no horizontal overflow at 390 or 1280px,
  reduced-motion rule present.
- `validate-page.mjs` on sample B: 122/122 contrast pass after the tool
  itself was fixed to alpha-composite translucent backgrounds (it first
  flagged the active nav link as white-on-white - a false positive, caught
  by inspection and fixed). The run then caught 5 animated elements with
  no prefers-reduced-motion fallback; the fixture gained the rule and the
  check now fails runs that animate without one. Keyboard traversal reaches all 11 focusable elements (12 stops incl.
  the closing cycle), indicator on every stop.
- `palette-check.mjs` reproduced the footer regression (old tint FAIL
  4.06:1, new tint PASS 5.05:1) and marked the status-series pairs
  (~1.0:1 between ok/warn/err) 'weak' - they separate by hue, not
  luminance; sample B pairs them with text labels.
- `pixel-diff.py`: identical renders 0.00% changed; different pages
  35.96% changed with the full-region box. It is a drift alarm, not a
  quality judgment.

Scope note: contrast is computed on sampled visible text elements (all
of them in these fixtures), which is not a WCAG certification; font
status 'loaded' proves the face arrived in this browser, not that every
glyph renders correctly; the reduced-motion check verifies a fallback
rule exists, not that motion is calm in practice; Tab traversal proves
reachability and a visible indicator, not that each control works.
Limit stands: these tools verify mechanics, not design quality, copy
truthfulness, or owner acceptance. The Apple trial (original won) is the
current evidence for that boundary.
