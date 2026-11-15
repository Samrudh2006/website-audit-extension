# Fix workflow - audit, review, fix, re-test, show the difference

This package's end-to-end loop, and its honest limits. It is a CLI workflow
you (or your coding tool) drive; it is not a magic one-command auto-fixer.

```
node tools/validate-page.mjs page.html --widths 390,1280 > before.json
  -> findings, each with check-specific scope
plan the fix (see below)
apply the fix
node tools/validate-page.mjs page.html --widths 390,1280 > after.json
  -> same checks, now green or honestly still open
python3 tools/pixel-diff.py before.png after.png   # optional visual drift
```

## What gets fixed automatically

Exactly one thing today: `tools/ensure-reduced-motion.mjs` adds a marked,
additive prefers-reduced-motion fallback block, after writing a `.bak`
backup. It is automatic because it is mechanical, additive and reversible -
and even it prints the exact plan first and only applies with `--apply`.

Everything else - contrast colours, typography, layout, spacing, copy,
imagery, brand, component choices - is **review-gated**: the tool reports the
finding with its evidence, a human (the page owner) decides the fix, and the
re-run proves it landed. The package never rewrites brand colours, never
invents content, and never claims a page is "AI-free" or certified anything.

## Review-gated fix loop (per finding)

1. **Finding** from validate-page output: check name, element, measured
   values (e.g. `footer fine print: 4.06:1, needs 4.5:1`).
2. **Plan**: the exact change before touching the file - current value,
   proposed value, where it goes, what NOT to touch. For contrast, pick the
   new colour with `node tools/palette-check.mjs palette.json` before
   editing: the pair must pass there first.
3. **Owner decision**: if the change alters what the page says or how the
   brand looks, the owner sees the plan before it is applied. Two legitimate
   routes (e.g. darken text vs. darken background) are presented as a
   choice, never silently picked.
4. **Apply** the planned change exactly.
5. **Re-test** with the same command; the finding must be gone without new
   failures. Keep `before.json` / `after.json` (and screenshots +
   pixel-diff when the change is visual) as the evidence.
6. **Reversibility**: work in git or keep backups; every applied change must
   be restorable. If a fix cannot be made reversible, say so in the plan.

## What "done" means

All validate-page checks pass with their stated scope, any manual-review
items have been eyeballed and noted, and the before/after evidence is kept.
"Done" never means "guaranteed good design" or "proves a human made it" -
those claims are out of scope for this package by design.
