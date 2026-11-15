# Coverage matrix: what the tools actually check, and what stays manual

Every checklist claim in SKILL.md, mapped to the mechanism that verifies it -
or marked MANUAL when no tool does. The suite count (43/43) covers only the
mechanized rows below, only on the shipped fixtures. It is not an
accessibility certification and not proof a page is good.

## Mechanized (validate-page.mjs)

| SKILL.md claim | Check | Limits (state these, never overclaim) |
| --- | --- | --- |
| Contrast meets WCAG 2.2 SC 1.4.3 | computed-style ratio of rendered visible text vs resolved background | sampled rendered text nodes at the FIRST --widths value only; backgrounds over images/gradients can be UNVERIFIABLE (listed, not failed); not every possible pair |
| Keyboard operability | real Tab walk: stops vs tabbable count, cycle detection, visible focus indicator per stop | indicator detection is geometric (outline/shape change); static-shadow styles go to manual review; --max-tab-stops truncation is a FAIL |
| Rendered font variants have glyphs | FontFaceSet.check per rendered variant | face availability for the sample only - not glyph correctness for all text, not pairing quality; blocked-by---offline variants become MANUAL REVIEW |
| No horizontal overflow | scrollWidth vs clientWidth at every --widths value | viewport-width checks only, not readability |
| Reduced-motion fallback | animated elements (computed) require a prefers-reduced-motion rule | rule PRESENCE, not computed behavior after the media query |

## Mechanized (nav-check.mjs)

| SKILL.md claim | Probe | Limits |
| --- | --- | --- |
| Dropdown/drawer opens, aria-expanded flips, focus moves in, Escape closes, focus returns, background inert | 11 interactive probes via [aria-controls] hooks | only components using aria-controls hooks; native focus() scroll is not exercised (modeled scrollIntoView used where relevant) |
| Sticky header never covers focus / anchor targets | focus-occlusion RISK probe + anchor-click probe | focus probe is a modeled alignment, not a native Tab walk - a hit is a risk to confirm by keyboard; anchor probe assumes instant scroll-behavior; top bars only (no bottom/side rails) |
| Collapse before overlap (links crowd at 360px) | 360px crowding probe | one width (360px); control matching is a label heuristic; never mandates a hamburger - messages name the observed overlap/overflow |

## Mechanized (palette-check.mjs, ensure-reduced-motion.mjs, pixel-diff.py)

| Claim | Tool | Limits |
| --- | --- | --- |
| Palette hex validity, alpha compositing over real backgrounds | palette-check | static palette JSON, not the rendered page |
| One auto-fixable reduced-motion pattern | ensure-reduced-motion (--apply) | refuses stale .bak, external CSS, and comment-stripped ambiguity by design (exit 3) |
| Before/after drift | pixel-diff.py | per-channel pixel diff; tolerance is the caller's judgment |

## MANUAL - no tool covers these; review by hand, every time

- `aria-current="page"` + a visible non-color cue for the current page
  (in the navbar AND inside the drawer) - not probed anywhere.
- Page-behind-drawer scroll-trap - not probed.
- "Three visible links never collapse" (over-collapsing) - the crowding
  probe only catches under-collapsing.
- Hamburger button placement (leading side, LTR/RTL) and drawer side.
- Header clutter restraint (which of login/search/CTA earned their slot) -
  design judgment.
- Logo links home, clear space, consistent sizing across pages.
- Footer: group order preserved and columns legible when stacked
  (overflow is checked; legibility and order are not).
- Selected vs focused as distinct states, non-color selection cue.
- Charts: the right form for the task (bar/line/scatter/diagram/table/text)
  is a human decision; examples/charts-gallery.html is the worked reference,
  checks only keep it contrast/overflow/motion-clean.
- Typography pairing and placement fit - glyph checks say nothing about taste.
- Everything --offline could not fetch (see validate-page header: restricted
  network is best-effort, with known holes).
