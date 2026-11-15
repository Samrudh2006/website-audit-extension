#!/bin/bash
# Unit regression tests for the validation tools. Each test asserts one fixed bug
# stays fixed. Run from the package root: bash tools/tests/run-tests.sh
set -u
cd "$(dirname "$0")/../.."
T=tools/tests
pass=0; fail=0
check() { # name condition
  if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (got '$2', want '$3')"; fail=$((fail+1)); fi
}

echo "== pixel-diff =="
python3 - <<'PY'
from PIL import Image
base = Image.new('RGB', (64, 64), (250, 247, 242))
base.save('/tmp/t-base.png')
blue = base.copy()
for x in range(16, 48):
    for y in range(16, 48):
        r, g, b = base.getpixel((x, y))
        blue.putpixel((x, y), (r, g, 60))   # blue-channel-only change of ~182
blue.save('/tmp/t-blue.png')
PY
out=$(python3 tools/pixel-diff.py /tmp/t-base.png /tmp/t-blue.png)
echo "$out" | grep -q 'changed pixels beyond per-channel tolerance 16: 1024 of 4096 (25.00%)' && r=ok || r="bad: $out"
check "blue-only channel change detected (luminance diff would miss this)" "$r" ok
out=$(python3 tools/pixel-diff.py /tmp/t-base.png /tmp/t-base.png)
echo "$out" | grep -q '(0.00%)' && r=ok || r="bad: $out"
check "identical images report zero drift" "$r" ok
python3 tools/pixel-diff.py --tolerance notanum /tmp/t-base.png /tmp/t-blue.png 2>/dev/null; check "argparse rejects non-numeric tolerance" "$?" 2

echo "== palette-check =="
cat > /tmp/t-pal-bad.json <<'JSON'
{"text_pairs":[{"name":"bad","fg":"#ZZZZZZ","bg":"#FFFFFF"}]}
JSON
node tools/palette-check.mjs /tmp/t-pal-bad.json 2>/dev/null; check "malformed hex rejected, exit 2" "$?" 2
cat > /tmp/t-pal-alpha.json <<'JSON'
{"text_pairs":[{"name":"alpha fg","fg":"#241F1C80","bg":"#FAF7F2"}]}
JSON
out=$(node tools/palette-check.mjs /tmp/t-pal-alpha.json)
echo "$out" | grep -q 'composited over bg' && r=ok || r="bad: $out"
check "8-digit hex composited and noted" "$r" ok
cat > /tmp/t-pal-len.json <<'JSON'
{"text_pairs":[{"name":"bad len","fg":"#12345","bg":"#FFFFFF"}]}
JSON
node tools/palette-check.mjs /tmp/t-pal-len.json 2>/dev/null; check "5-digit hex rejected, exit 2" "$?" 2

echo "== validate-page fixtures =="
node tools/validate-page.mjs $T/fixture-dup-logo.html --widths 1280 > /tmp/t-dup.json 2>/dev/null
ec=$?
python3 - <<PY
import json
raw = open('/tmp/t-dup.json').read()
rep = json.loads(raw[:raw.rindex('---')])
kb = rep['keyboard']
assert kb['expectedTabbable'] == 6, kb
assert kb['cycleReached'] is True and kb['truncated'] is False, kb
assert kb['uncoveredExpected'] == [], kb
assert len(kb['stopsWithoutIndicator']) == 0, kb
print('dup-logo: 6 tabbable, full coverage, cycle via stable registry (identical logo links do not confuse it)')
PY
check "duplicate logo links: full coverage, real cycle" "$?" 0

node tools/validate-page.mjs $T/fixture-opacity.html --widths 1280 > /tmp/t-opa.json 2>/dev/null
python3 - <<PY
import json
raw = open('/tmp/t-opa.json').read()
rep = json.loads(raw[:raw.rindex('---')])
c = rep['contrast']
assert c['pass'] == 0 and len(c['fail']) == 0, c
assert len(c['unverifiable']) == 2, c
assert 'opacity' in c['unverifiable'][0]['reason'], c
print('opacity: both text nodes manual-review, none passed through group opacity')
PY
check "low-opacity container: manual review, never pass" "$?" 0

node tools/validate-page.mjs $T/fixture-indicators.html --widths 1280 > /tmp/t-ind.json 2>/dev/null
python3 - <<PY
import json
raw = open('/tmp/t-ind.json').read()
rep = json.loads(raw[:raw.rindex('---')])
kb = rep['keyboard']
assert len(kb['stopsWithoutIndicator']) == 1, kb
assert kb['stopsWithoutIndicator'][0]['text'] == 'No indicator', kb
assert len(kb['indicatorManualReview']) == 1, kb
assert kb['indicatorManualReview'][0]['text'] == 'Static shadow', kb
print('indicators: 1 verified-change, 1 static-shadow manual review, 1 no-indicator FAIL')
PY
check "focus indicator: verified-change vs static vs none" "$?" 0

node tools/validate-page.mjs $T/fixture-dup-logo.html --widths 1280 --max-tab-stops 4 > /tmp/t-trunc.json 2>/dev/null; ec=$?
python3 - <<PY
import json
raw = open('/tmp/t-trunc.json').read()
rep = json.loads(raw[:raw.rindex('---')])
assert rep['keyboard']['truncated'] is True, rep['keyboard']
print('truncation: max-stops cutoff flagged, not passed')
PY
check "truncated cycle fails (exit 1)" "$?" 0
check "truncated cycle exit code" "$ec" 1

echo "== ensure-reduced-motion end-to-end =="
rm -f /tmp/t-motion.html /tmp/t-motion.html.bak   # clean slate; a stale .bak must refuse
cp $T/fixture-motion.html /tmp/t-motion.html
node tools/validate-page.mjs /tmp/t-motion.html --widths 1280 > /tmp/t-mot-before.json 2>/dev/null; ec=$?
check "fixture with animation and no fallback FAILS the audit" "$ec" 1
node tools/ensure-reduced-motion.mjs /tmp/t-motion.html > /tmp/t-mot-plan.txt 2>&1; ec=$?
check "review mode prints plan, exits 1, applies nothing" "$ec" 1
cmp -s /tmp/t-motion.html $T/fixture-motion.html && r=ok || r=changed
check "review mode left the file untouched" "$r" ok
node tools/ensure-reduced-motion.mjs /tmp/t-motion.html --apply > /tmp/t-mot-apply.txt 2>&1; ec=$?
check "apply mode exits 0" "$ec" 0
[ -f /tmp/t-motion.html.bak ] && r=ok || r=missing
check "backup written for reversibility" "$r" ok
node tools/validate-page.mjs /tmp/t-motion.html --widths 1280 > /tmp/t-mot-after.json 2>/dev/null; ec=$?
check "re-test passes after the applied fix" "$ec" 0
cp /tmp/t-motion.html.bak /tmp/t-motion-restored.html
cmp -s /tmp/t-motion-restored.html $T/fixture-motion.html && r=ok || r=differs
check "restoring the backup reproduces the original exactly" "$r" ok

echo "== ensure-reduced-motion adversarial cases =="
# stale backup: apply must refuse, not silently keep an outdated .bak
cp $T/fixture-motion.html /tmp/t-stale.html
printf 'OLD VERSION' > /tmp/t-stale.html.bak
node tools/ensure-reduced-motion.mjs /tmp/t-stale.html --apply > /tmp/t-stale.log 2>&1; ec=$?
check "stale .bak: apply refuses (exit 2)" "$ec" 2
cmp -s /tmp/t-stale.html $T/fixture-motion.html && r=ok || r=changed
check "stale .bak: input untouched" "$r" ok
grep -q 'OLD VERSION' /tmp/t-stale.html.bak && r=ok || r=overwritten
check "stale .bak: old backup preserved" "$r" ok

# comment mention must not count as a fallback rule
sed 's|</style>|/* prefers-reduced-motion handled elsewhere */</style>|' $T/fixture-motion.html > /tmp/t-comment.html
node tools/ensure-reduced-motion.mjs /tmp/t-comment.html > /tmp/t-comment.log 2>&1; ec=$?
check "comment mention does not false-pass (exit 1)" "$ec" 1

# no-preference media query is not a fallback
sed 's|</style>|@media (prefers-reduced-motion: no-preference){.pulse{animation-duration:2s}}</style>|' $T/fixture-motion.html > /tmp/t-nopref.html
node tools/ensure-reduced-motion.mjs /tmp/t-nopref.html > /tmp/t-nopref.log 2>&1; ec=$?
check "no-preference query does not false-pass (exit 1)" "$ec" 1
node tools/validate-page.mjs /tmp/t-nopref.html --widths 1280 > /tmp/t-nopref-val.json 2>/dev/null; ec=$?
check "validate-page also rejects no-preference as fallback (exit 1)" "$ec" 1

# external stylesheet: manual review, never a verdict
sed 's|<head>|<head><link rel="stylesheet" href="x.css">|' $T/fixture-motion.html > /tmp/t-ext.html
node tools/ensure-reduced-motion.mjs /tmp/t-ext.html > /tmp/t-ext.log 2>&1; ec=$?
check "linked CSS: manual review (exit 3), no verdict" "$ec" 3

echo "== nav-check interactive probes =="
node tools/nav-check.mjs $T/fixture-nav-good.html > /tmp/t-nav-good.log 2>&1; ec=$?
check "well-built nav passes all 11 probes" "$ec" 0
node tools/nav-check.mjs $T/fixture-nav-bad.html > /tmp/t-nav-bad.log 2>&1; ec=$?
check "broken nav fails (exit 1)" "$ec" 1
grep -q 'FAIL  Escape closes the dropdown' /tmp/t-nav-bad.log && grep -q 'FAIL  content behind the open drawer' /tmp/t-nav-bad.log && grep -q 'FAIL  focus moves inside the drawer' /tmp/t-nav-bad.log && r=ok || r=missing
check "broken nav: Escape/inert/focus failures each detected" "$r" ok
node tools/nav-check.mjs $T/fixture-plain.html > /tmp/t-nav-none.log 2>&1; ec=$?
check "page with nothing probeable: manual review (exit 3), not a verdict" "$ec" 3

echo "== nav-check sticky-header occlusion probes =="
node tools/nav-check.mjs $T/fixture-sticky-good.html > /tmp/t-sticky-good.log 2>&1; ec=$?
check "sticky header with scroll-padding passes occlusion probes" "$ec" 0
node tools/nav-check.mjs $T/fixture-sticky-bad.html > /tmp/t-sticky-bad.log 2>&1; ec=$?
check "sticky header without scroll-padding fails (exit 1)" "$ec" 1
grep -q 'FAIL  sticky/fixed header shows no focus-occlusion risk' /tmp/t-sticky-bad.log && grep -q 'FAIL  in-page anchor targets land below the sticky header' /tmp/t-sticky-bad.log && r=ok || r=missing
check "sticky occlusion: focus and anchor failures each detected" "$r" ok

echo "== charts gallery example =="
node tools/validate-page.mjs examples/charts-gallery.html --widths 390,1280 > /tmp/t-gallery.json 2>/dev/null; ec=$?
check "charts gallery passes the full audit at 390 and 1280" "$ec" 0

echo

echo "== validate-page --offline network isolation =="
node tools/tests/net-probe.mjs $T/fixture-offline-net.html --offline > /tmp/t-net-off.log 2>&1
grep -q '"fetch":"blocked"' /tmp/t-net-off.log && grep -q '"ws":"blocked"' /tmp/t-net-off.log && r=ok || r=missing
check "offline: fetch and WebSocket both blocked (local echo server)" "$r" ok
node tools/tests/net-probe.mjs $T/fixture-offline-net.html > /tmp/t-net-on.log 2>&1
grep -q '"fetch":"ok"' /tmp/t-net-on.log && grep -q '"ws":"ok"' /tmp/t-net-on.log && r=ok || r=retry
if [ "$r" = retry ]; then sleep 2; node tools/tests/net-probe.mjs $T/fixture-offline-net.html > /tmp/t-net-on.log 2>&1; grep -q '"fetch":"ok"' /tmp/t-net-on.log && grep -q '"ws":"ok"' /tmp/t-net-on.log && r=ok || r=missing; fi
check "online control: fetch and WebSocket reachable (needs internet; one retry on transient failure)" "$r" ok
node tools/validate-page.mjs $T/fixture-offline-net.html --widths 390 --offline > /tmp/t-val-offline.log 2>&1; ec=$?
check "offline validate exits 0 (blocked resources are unverified, not failures)" "$ec" 0
grep -q 'blocked by --offline - any webfonts it defines are unverified' /tmp/t-val-offline.log && grep -qE 'offline \(restricted network, best effort\): [1-9][0-9]* remote requests blocked' /tmp/t-val-offline.log && grep -q 'FALLBACK rendering - the fully-resourced page is UNVERIFIED' /tmp/t-val-offline.log && r=ok || r=missing
check "offline: blocked stylesheet surfaces as font manual-review, not failure" "$r" ok

node tools/nav-check.mjs $T/fixture-nav-good.html --offline > /tmp/t-nav-offline.log 2>&1; ec=$?
check "nav-check --offline: separate Chrome protected, good nav still passes" "$ec" 0

echo "== nav-check collapse-at-360px probe =="
node tools/nav-check.mjs $T/fixture-collapse-good.html > /tmp/t-collapse-good.log 2>&1; ec=$?
check "nav that collapses to a menu at 360px passes" "$ec" 0
node tools/nav-check.mjs $T/fixture-collapse-bad.html > /tmp/t-collapse-bad.log 2>&1; ec=$?
check "7 links overflowing at 360px with no hamburger fails (exit 1)" "$ec" 1
grep -q 'FAIL  nav links do not crowd at 360px' /tmp/t-collapse-bad.log && r=ok || r=missing
check "collapse crowding detected and named" "$r" ok
node tools/nav-check.mjs $T/fixture-collapse-unlabeled.html > /tmp/t-collapse-unlabeled.log 2>&1; ec=$?
check "crowding with an unlabeled icon button still fails (exit 1)" "$ec" 1
grep -q 'a small button is present but has no accessible name' /tmp/t-collapse-unlabeled.log && r=ok || r=missing
check "unlabeled-button case names the accessibility issue, not just crowding" "$r" ok

echo "unit tests: $pass passed, $fail failed"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
