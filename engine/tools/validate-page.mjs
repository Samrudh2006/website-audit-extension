// validate-page.mjs - runs the SKILL.md Step 13 checks against a local HTML page in
// headless Chrome over the DevTools protocol, and prints a JSON + readable report.
//
//   node tools/validate-page.mjs path/to/page.html [--widths 390,1280] [--max-tab-stops 200]
//
// What each check proves, and what it does not (read before trusting the output):
// - contrast: text color pairs use computed styles and the WCAG 2.2 relative
//   luminance formula (SC 1.4.3; large text per the WCAG point-size definition),
//   composited over ancestor backgrounds up to the root. Situations the formula
//   cannot model are reported 'unverifiable' for manual review, never passed:
//   text over images/gradients, ancestor opacity below 1, filters,
//   backdrop-filters, mix-blend-mode.
// - keyboard: REAL Tab key events (Input.dispatchKeyEvent), reading activeElement
//   at every stop. Elements are tagged with a stable index before the walk, so
//   duplicated links cannot confuse cycle detection. Coverage is compared
//   against the count of tabbable elements in the DOM; a walk that ends without
//   covering all of them (max-stops truncation or early exit) is a failure, not
//   a partial pass. A focus indicator counts as VERIFIED only when the computed
//   outline/box-shadow actually CHANGED on focus; an unchanged static style is
//   listed for manual review. Reachability + indicator is proven; whether the
//   control then works is not.
// - fonts: FontFaceSet.check() for every variant actually rendered (hidden
//   nodes excluded), testing glyph availability for the rendered sample text in
//   this browser. Handles variable-font weight ranges and system fonts. It does
//   not prove every glyph of the page renders correctly, and a blocked font
//   network on a user's machine is a different environment.
// - overflow: horizontal scrollWidth vs viewport at each width, plus the widest
//   offending elements. Proves layout does not force horizontal scrolling.
// - reduced-motion: whether stylesheets declare an actual
//   `@media (prefers-reduced-motion: reduce)` rule (a `no-preference` query or
//   a bare mention does not count) and whether animated elements exist.
//   Presence of the rule is not proof the motion is calm or that behavior
//   survives near-zero durations; click through with reduced motion emulated.
//
// Scope: contrast, keyboard and fonts are audited at the FIRST --widths value
// (default 390); overflow runs at every width. To audit another width, rerun
// with it first, e.g. --widths 1280,390.
//
// Exit code 1 when any check has failures, 0 otherwise (unverifiable and
// manual-review items do not fail the run; they are listed for a human).
import { launchChrome } from './chrome-cdp.mjs';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file || !existsSync(file)) {
    console.error('Usage: node tools/validate-page.mjs path/to/page.html [--widths 390,1280] [--max-tab-stops 200] [--offline]');
    process.exit(2);
}
const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i === -1 ? dflt : args[i + 1];
};
const widths = opt('--widths', '390,1280').split(',').map(Number);
const maxTabStops = Number(opt('--max-tab-stops', '200'));
// --offline: RESTRICTED NETWORK, BEST EFFORT - not isolation. Armed before first
// navigation. Anything a blocked request would have provided (fonts, CSS, JS,
// images) is reported as unverified, never as a failure.
// Tested (tools/tests/net-probe.mjs, fixture-offline-net.html):
//  - http/https page-JS fetch/XHR and subresources (stylesheets/fonts): BLOCKED
//    via Network.setBlockedURLs.
//  - page-JS WebSocket / EventSource in the MAIN realm: refused via new-document
//    constructor removal - CDP does NOT intercept WS handshakes (measured: a
//    local echo server still connects through both setBlockedURLs and
//    Fetch.requestPaused), so the ws URL patterns are belt-and-braces only.
// Known holes (stated, not silently claimed):
//  - A fresh realm (new iframe, about:blank frame) gets real WebSocket/fetch
//    constructors; the new-document script runs per-frame in this Chrome but
//    that is not suite-tested.
//  - Worker realms (dedicated/shared) have their own WebSocket/fetch; worker
//    network is NOT covered unless CDP auto-attach + per-worker Network.enable
//    is added and tested. Not done: worker fetches can reach the network.
//  - A page script capturing WebSocket/fetch references before the new-document
//    script runs keeps working handles.
//  - Remote Worker scripts are not probed (platform same-origin-blocks them).
// file://, data: and blob: always load.
// Interpretation: with blocked requests, contrast/keyboard/fonts audited the
// FALLBACK rendering - the fully-resourced page is unverified until rerun online.
const offline = args.includes('--offline');
const url = pathToFileURL(path.resolve(file)).href;

const { cdp, kill } = await launchChrome();
const { sessionId, page } = await cdp.openPage();
await page('Page.enable');
await page('Runtime.enable');
const blocked = [];
if (offline) {
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: 'window.WebSocket = undefined; window.EventSource = undefined;' });
    const seen = new Map();
    const listen = (method, cb) => {
        const reg = () => cdp.waitFor(method, sessionId, () => true).then((p) => { cb(p); reg(); }, () => {});
        reg();
    };
    listen('Network.requestWillBeSent', (p) => seen.set(p.requestId, p.request.url));
    listen('Network.loadingFailed', (p) => {
        if (p.blockedReason && blocked.length < 50) blocked.push({ url: seen.get(p.requestId) || p.requestId, reason: p.blockedReason });
    });
}
const loaded = cdp.waitFor('Page.loadEventFired', undefined, () => true);
await page('Page.navigate', { url });
await loaded;
console.error('[phase] loaded, settling fonts');
await new Promise((r) => setTimeout(r, 500));
try { await Promise.race([page('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true }), new Promise((r) => setTimeout(r, 8000))]); } catch {}
await page('Emulation.setDeviceMetricsOverride', { width: widths[0], height: 900, deviceScaleFactor: 1, mobile: widths[0] < 500 });
await new Promise((r) => setTimeout(r, 300));
console.error('[phase] contrast (audited at width ' + widths[0] + 'px - the first --widths value)');

async function evaljs(expression) {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(`page eval failed: ${exceptionDetails.text} ${exceptionDetails.exception?.description || ''}`);
    return result.value;
}

// ---------- 1. Contrast (computed styles, WCAG 2.2 SC 1.4.3) ----------
const contrast = await evaljs(`(() => {
    const toRGB = (s) => {
        const m = s.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
        const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
        const la = lum(a), lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const over = (top, bottom) => {
        const a = top.a + bottom.a * (1 - top.a);
        if (a === 0) return { r: 255, g: 255, b: 255, a: 1 };
        const c = (t, b) => Math.round((t * top.a + b * bottom.a * (1 - top.a)) / a);
        return { r: c(top.r, bottom.r), g: c(top.g, bottom.g), b: c(top.b, bottom.b), a: 1 };
    };
    const bgOf = (el) => {
        const layers = [];
        let node = el;
        while (node) {
            const bg = toRGB(getComputedStyle(node).backgroundColor);
            if (bg && bg.a > 0) layers.push(bg);
            if (bg && bg.a >= 0.999) break;
            node = node.parentElement;
        }
        let base = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
        return base;
    };
    const isVisible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    // Stacking situations the luminance formula cannot model: images/gradients,
    // group opacity below 1, filters, backdrop-filters, blend modes. These are
    // reported for manual review and can never produce a PASS.
    const unsupportedStacking = (el) => {
        let node = el;
        while (node) {
            const cs = getComputedStyle(node);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'text over image/gradient background';
            if (Number(cs.opacity) < 0.999) return 'element or ancestor opacity below 1 (group compositing changes the ratio)';
            if (cs.filter && cs.filter !== 'none') return 'element or ancestor filter applied';
            if ((cs.backdropFilter || 'none') !== 'none') return 'element or ancestor backdrop-filter applied';
            if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return 'element or ancestor mix-blend-mode';
            node = node.parentElement;
        }
        return null;
    };
    const seen = new Set();
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let node;
    while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (!el || seen.has(el) || !isVisible(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const fg = toRGB(cs.color);
        if (!fg) continue;
        const sizePx = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
        const need = large ? 3.0 : 4.5;
        const label = (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + node.textContent.trim().slice(0, 40) + '"');
        const unsupported = unsupportedStacking(el);
        if (unsupported) {
            results.push({ status: 'unverifiable', label, reason: unsupported + ' - needs visual check' });
            continue;
        }
        const bg = bgOf(el);
        const fgC = fg.a < 0.999 ? over(fg, bg) : { ...fg, a: 1 };
        const r = ratio(fgC, bg);
        results.push({ status: r + 1e-9 >= need ? 'pass' : 'fail', label, ratio: Math.round(r * 100) / 100, need, fg: cs.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', large });
    }
    return results;
})()`);

// ---------- 2. Keyboard: real Tab events, stable element registry, change-verified indicators ----------
const tabKey = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
// Tag every focusable element with a stable index BEFORE the walk, and record
// its unfocused baseline indicator styles. Identity is this index, never
// tag/id/href/text (duplicated logo links are identical on all of those).
const kbSetup = await evaljs(`(() => {
    const SELECTOR = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], audio[controls], video[controls]';
    const isShown = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const all = [...document.querySelectorAll(SELECTOR)];
    const baseline = {};
    all.forEach((el, i) => {
        el.dataset.vpKb = String(i);
        const cs = getComputedStyle(el);
        baseline[i] = {
            outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor, boxShadow: cs.boxShadow,
            label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + ((el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 40)) + '"',
        };
    });
    const expected = all.filter((el) => !el.disabled && el.tabIndex >= 0 && isShown(el)).map((el) => el.dataset.vpKb);
    (document.activeElement && document.activeElement.blur) && document.activeElement.blur();
    document.body.focus && document.body.focus();
    return { expected, baseline };
})()`);
console.error('[phase] keyboard');
const stops = [];
let focusEscapes = 0;
let breakReason = 'max-stops';
for (let i = 0; i < maxTabStops; i++) {
    await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...tabKey });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...tabKey });
    const info = await evaljs(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.dataset.vpKb === undefined) return { body: true };
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
            body: false,
            kb: el.dataset.vpKb,
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            href: el.getAttribute('href') || '',
            text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 50),
            outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor, boxShadow: cs.boxShadow,
            visible: r.width > 0 && r.height > 0,
        };
    })()`);
    if (info.body) { focusEscapes++; if (focusEscapes >= 2) { breakReason = 'body-exit'; break; } continue; }
    focusEscapes = 0;
    stops.push(info);
    if (stops.length > 2 && info.kb === stops[0].kb) { breakReason = 'cycle'; break; }
}
// Indicator: an outline or shadow counts as VERIFIED only when focus changed it.
// A static style that looks identical unfocused is listed for manual review.
const transparent = (c) => c === 'transparent' || /rgba?\([^)]*,\s*0(\.0+)?\s*\)$/.test(c);
for (const st of stops) {
    const base = kbSetup.baseline[st.kb];
    const outlineOn = parseFloat(st.outlineWidth) > 0 && st.outlineStyle !== 'none' && !transparent(st.outlineColor);
    const shadowOn = st.boxShadow !== 'none';
    const changed = st.outlineWidth !== base.outlineWidth || st.outlineStyle !== base.outlineStyle || st.outlineColor !== base.outlineColor || st.boxShadow !== base.boxShadow;
    st.indicator = (outlineOn || shadowOn) ? (changed ? 'verified-change' : 'static-style-manual-review') : 'none';
}
const reached = new Set(stops.map((st) => st.kb));
const uncovered = kbSetup.expected.filter((k) => !reached.has(k)).map((k) => kbSetup.baseline[k].label);
const keyboard = {
    expectedTabbable: kbSetup.expected.length,
    stops: stops.length,
    cycleReached: breakReason === 'cycle',
    truncated: breakReason === 'max-stops',
    breakReason,
    uncoveredExpected: uncovered,
    noIndicator: stops.filter((st) => st.indicator === 'none'),
    manualReviewIndicator: stops.filter((st) => st.indicator === 'static-style-manual-review'),
    invisibleStops: stops.filter((st) => !st.visible),
    detail: stops,
};

console.error('[phase] fonts');
// ---------- 3. Fonts: glyph availability for rendered variants (hidden nodes excluded) ----------
const fonts = await evaljs(`(() => {
    const used = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    let n;
    while ((n = walker.nextNode())) {
        const el = n.parentElement;
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const spec = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        if (!used.has(spec)) used.set(spec, n.textContent.trim().slice(0, 24));
    }
    // FontFaceSet.check(spec, sample) matches against the full font set,
    // including variable-font weight ranges and system fonts, and verifies the
    // sample's glyphs are available. Exact-weight matching would false-fail both.
    const rendered = [];
    for (const [spec, sample] of used) {
        let ok = null;
        try { ok = document.fonts.check(spec, sample); } catch { ok = null; }
        rendered.push({ spec, sample, glyphsAvailable: ok });
    }
    const faces = [];
    document.fonts.forEach((f) => faces.push({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
    return { renderedVariants: rendered, faces };
})()`);

console.error('[phase] overflow');
// ---------- 4. Horizontal overflow at each width ----------
const overflow = [];
for (const w of widths) {
    await page('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 500 });
    await new Promise((r) => setTimeout(r, 300));
    const res = await evaljs(`(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const offenders = [];
        if (sw > vw + 1) {
            const all = document.querySelectorAll('body *');
            for (const el of all) {
                const r = el.getBoundingClientRect();
                if (r.right > vw + 1 && r.width > 20) offenders.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' right=' + Math.round(r.right));
                if (offenders.length >= 5) break;
            }
        }
        return { viewport: vw, scrollWidth: sw, overflows: sw > vw + 1, offenders };
    })()`);
    overflow.push({ width: w, ...res });
}
await page('Emulation.clearDeviceMetricsOverride');

console.error('[phase] motion');
// ---------- 5. Reduced motion ----------
const motion = await evaljs(`(() => {
    let hasRMRule = false, scanned = 0, blocked = 0;
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { blocked++; continue; }
        scanned++;
        const walk = (list) => {
            for (const rule of list) {
                if (rule.conditionText && /prefers-reduced-motion\\s*:\\s*reduce/.test(rule.conditionText)) hasRMRule = true;
                if (rule.cssRules) walk(rule.cssRules);
            }
        };
        walk(rules);
    }
    let animated = 0;
    const all = document.querySelectorAll('body *');
    for (const el of all) {
        const cs = getComputedStyle(el);
        if ((cs.animationName && cs.animationName !== 'none') || (parseFloat(cs.transitionDuration) > 0)) animated++;
    }
    return { stylesheetsScanned: scanned, stylesheetsBlocked: blocked, hasReducedMotionRule: hasRMRule, animatedElements: animated };
})()`);

const contrastFails = contrast.filter((c) => c.status === 'fail');
const contrastUnver = contrast.filter((c) => c.status === 'unverifiable');
// A variant is a problem only when FontFaceSet.check reports its sample glyphs
// unavailable; a null (check threw) is listed for manual review, not failed.
const fontProblems = fonts.renderedVariants.filter((v) => v.glyphsAvailable === false).map((v) => ({ renderedVariant: v.spec, sample: v.sample, status: 'glyphs unavailable' }));
const fontManualReview = fonts.renderedVariants.filter((v) => v.glyphsAvailable === null).map((v) => ({ renderedVariant: v.spec, status: 'check unavailable - manual review' }));
if (offline && fontProblems.length) {
    // A blocked webfont is a verification gap, not a defect: never fail offline.
    for (const p of fontProblems) fontManualReview.push({ renderedVariant: p.renderedVariant, sample: p.sample, status: 'unverifiable while --offline blocks the network - rerun online to verify' });
    fontProblems.length = 0;
}
if (offline) {
    // Blocked stylesheets/font files may define webfonts that silently fell
    // back - surface that as a manual-review item, never a silent pass.
    const fontish = blocked.filter((b) => /\.css|font|\.woff2?|\.otf|\.ttf/i.test(b.url));
    for (const b of fontish) fontManualReview.push({ renderedVariant: '(remote stylesheet/font)', sample: b.url, status: 'blocked by --offline - any webfonts it defines are unverified; fallback rendered instead' });
}
const overflowFails = overflow.filter((o) => o.overflows);
const motionFail = motion.animatedElements > 0 && !motion.hasReducedMotionRule ? 1 : 0;
const failures =
    contrastFails.length + keyboard.noIndicator.length + keyboard.invisibleStops.length +
    keyboard.uncoveredExpected.length + (keyboard.truncated ? 1 : 0) +
    fontProblems.length + overflowFails.length + motionFail;

const report = {
    page: path.basename(file),
    auditedWidth: widths[0],
    scope: 'contrast, keyboard and fonts audited at the first --widths value (' + widths[0] + 'px); overflow at each width; rerun with reordered --widths to audit another width',
    contrast: { checked: contrast.length, pass: contrast.filter((c) => c.status === 'pass').length, fail: contrastFails, unverifiable: contrastUnver },
    keyboard: {
        expectedTabbable: keyboard.expectedTabbable,
        tabStops: keyboard.stops,
        cycleReached: keyboard.cycleReached,
        truncated: keyboard.truncated,
        breakReason: keyboard.breakReason,
        uncoveredExpected: keyboard.uncoveredExpected,
        stopsWithoutIndicator: keyboard.noIndicator,
        indicatorManualReview: keyboard.manualReviewIndicator,
        invisibleStops: keyboard.invisibleStops,
    },
    fonts: { renderedVariants: fonts.renderedVariants, problems: fontProblems, manualReview: fontManualReview, faceCount: fonts.faces.length },
    overflow,
    motion: { ...motion, rule: 'guide rule: pages with animated elements must ship a prefers-reduced-motion fallback', fails: motionFail === 1 },
    offline: offline ? { enabled: true, blockedRequests: blocked, blockedCountNote: 'requests observed at a bounded 400ms settle cutoff - late events may be missed', note: 'RESTRICTED NETWORK, best effort - not isolation. http/https blocked via Network.setBlockedURLs (tested); main-realm WebSocket/EventSource refused via new-document script (tested; CDP does not intercept WS handshakes at network level). Known holes: fresh iframe/worker realms, pre-injection reference capture, worker fetch (needs CDP auto-attach, not done). file://, data:, blob: allowed.',
        surfaceUnverified: blocked.length > 0 ? 'blocked requests mean contrast/keyboard/fonts audited the FALLBACK rendering; the fully-resourced page is unverified - rerun online before trusting a 0-failure result' : null } : { enabled: false },
    summary: { failures },
};
if (offline) await new Promise((r) => setTimeout(r, 400)); // bounded wait: lets most late loadingFailed events land before summarizing - blockedRequests is the count OBSERVED AT THIS CUTOFF, not a guarantee every late event was captured
console.log(JSON.stringify(report, null, 2));
console.log('---');
console.log(`contrast: ${report.contrast.pass}/${contrast.length} pass, ${contrastFails.length} fail, ${contrastUnver.length} need visual check`);
console.log(`keyboard: ${keyboard.stops} stops covering ${reached.size}/${keyboard.expectedTabbable} tabbable elements, cycle ${keyboard.cycleReached ? 'completed' : keyboard.truncated ? 'TRUNCATED at max-stops (FAIL)' : 'not completed (body-exit)'}, ${keyboard.noIndicator.length} stops with no indicator, ${keyboard.manualReviewIndicator.length} static-style stops to review by eye`);
console.log(`fonts: ${fonts.renderedVariants.length} rendered variants, ${fontProblems.length} with unavailable glyphs, ${fontManualReview.length} to review manually`);
console.log(`overflow: ${overflow.map((o) => `${o.width}px ${o.overflows ? 'OVERFLOW' : 'ok'}`).join(', ')}`);
console.log(`motion: ${motion.animatedElements} animated elements, reduced-motion rule ${motion.hasReducedMotionRule ? 'present' : 'MISSING'}`);
if (offline) console.log(`offline (restricted network, best effort): ${blocked.length} remote requests blocked${blocked.length ? ' (' + blocked.slice(0, 5).map((b) => b.url).join(', ') + (blocked.length > 5 ? ', ...' : '') + ')' : ''} - blocked-provided resources unverified, not failed`);
if (offline && blocked.length) console.log('offline caveat: with blocked requests, contrast/keyboard/fonts audited the FALLBACK rendering - the fully-resourced page is UNVERIFIED; rerun online before trusting a 0-failure result');
await kill();
process.exit(failures ? 1 : 0);
