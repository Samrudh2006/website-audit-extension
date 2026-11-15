// nav-check.mjs - interactive behavior probes for header navigation patterns.
//
//   node tools/nav-check.mjs page.html
//
// Requires the page to use these hooks (documented in SKILL.md's navigation
// section): a dropdown whose trigger has [aria-controls] pointing at its
// panel, and/or a drawer whose trigger has [aria-controls] pointing at the
// drawer container. Pages without these hooks are reported as MANUAL REVIEW,
// not failed - the checker cannot guess your structure.
//
// Probes (real events: JS clicks for pointing, real CDP key events for keys):
//   1. dropdown opens on trigger click, aria-expanded flips true, focus moves into the panel
//   2. Escape closes the dropdown and returns focus to the trigger
//   3. drawer opens on trigger click, focus moves inside it
//   4. Escape closes the drawer and returns focus to the pre-open element
//   5. while the drawer is open, main content is unreachable to keyboard/AT
//      (inert, aria-hidden, or visibility hidden) - else FAIL
// What this proves: these specific behaviors, as scripted. What it does not:
// visual quality, screen-reader announcements, touch behavior, or patterns the
// hooks don't describe. Exit 1 on any failed probe, 0 when all pass, 3 when
// no hooks were found (manual review).
import { launchChrome } from './chrome-cdp.mjs';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file || !existsSync(file)) { console.error('Usage: node tools/nav-check.mjs page.html [--offline]'); process.exit(2); }
// --offline: same best-effort restricted network as validate-page (see its
// header comment for the tested scope and the known holes: iframe/worker
// realms, pre-injection capture, worker fetch). This tool launches its own
// Chrome, so the flag must be passed here too - validate-page --offline does
// NOT cover nav-check runs.
const offline = process.argv.slice(2).includes('--offline');

const { cdp, kill } = await launchChrome();
const { page } = await cdp.openPage();
await page('Page.enable');
await page('Runtime.enable');
if (offline) {
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: 'window.WebSocket = undefined; window.EventSource = undefined;' });
    console.error('[offline] restricted network armed (best effort - see validate-page header for known holes)');
}
const loaded = cdp.waitFor('Page.loadEventFired', undefined, () => true);
await page('Page.navigate', { url: pathToFileURL(path.resolve(file)).href });
await loaded;
await new Promise((r) => setTimeout(r, 300));

const evaljs = async (expression) => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error('eval failed: ' + exceptionDetails.text);
    return result.value;
};
const pressKey = async (key, code, vk) => {
    await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await new Promise((r) => setTimeout(r, 120));
};

const results = [];
const probe = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); };

const found = await evaljs(`(() => {
    const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const triggers = [...document.querySelectorAll('[aria-controls]')].filter((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
    const out = { dropdown: null, drawer: null };
    for (const t of triggers) {
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (!panel) continue;
        const isDrawer = panel.getAttribute('role') === 'dialog' || panel.getAttribute('aria-modal') === 'true' || /drawer|menu|sidebar/i.test(panel.id + ' ' + (panel.className || ''));
        const entry = { trigger: t.id || null, triggerText: (t.innerText || '').trim().slice(0, 30), panel: panel.id };
        if (isDrawer && !out.drawer) out.drawer = entry;
        else if (!isDrawer && !out.dropdown) out.dropdown = entry;
    }
    return out;
})()`);

// Mark elements so focus checks can name them reliably.
await evaljs(`(() => { document.querySelectorAll('a,button,[tabindex]').forEach((el, i) => el.dataset.vpNav = String(i)); return 1; })()`);
const activeTag = () => evaljs(`(() => { const el = document.activeElement; return el ? (el.dataset.vpNav !== undefined ? 'nav-' + el.dataset.vpNav + ' ' + el.tagName.toLowerCase() : el.tagName.toLowerCase()) : 'none'; })()`);

if (found.dropdown) {
    const d = found.dropdown;
    const r1 = await evaljs(`(() => {
        const t = document.querySelector('[aria-controls="${d.panel}"]');
        t.click();
        const panel = document.getElementById('${d.panel}');
        const vis = getComputedStyle(panel).display !== 'none' && getComputedStyle(panel).visibility !== 'hidden';
        const expanded = t.getAttribute('aria-expanded');
        const focusInside = panel.contains(document.activeElement);
        return { vis, expanded, focusInside };
    })()`);
    probe('dropdown opens on trigger click', r1.vis, `panel visible: ${r1.vis}`);
    probe('dropdown trigger aria-expanded true when open', r1.expanded === 'true', `aria-expanded=${r1.expanded}`);
    probe('focus moves into the dropdown panel on open', r1.focusInside);
    const before = await activeTag();
    await pressKey('Escape', 'Escape', 27);
    const r2 = await evaljs(`(() => {
        const panel = document.getElementById('${d.panel}');
        const t = document.querySelector('[aria-controls="${d.panel}"]');
        return { vis: getComputedStyle(panel).display !== 'none' && getComputedStyle(panel).visibility !== 'hidden', expanded: t.getAttribute('aria-expanded'), active: document.activeElement === t };
    })()`);
    probe('Escape closes the dropdown', !r2.vis, `panel visible after Escape: ${r2.vis}`);
    probe('aria-expanded false after Escape', r2.expanded === 'false' || r2.expanded === null, `aria-expanded=${r2.expanded}`);
    probe('focus returns to the dropdown trigger after Escape', r2.active, `focus on: ${await activeTag()}`);
}

if (found.drawer) {
    const dr = found.drawer;
    const preOpen = await evaljs(`(() => { const t = document.querySelector('[aria-controls="${dr.panel}"]'); t.focus(); return t.dataset ? t.dataset.vpNav : null; })()`);
    const r1 = await evaljs(`(() => {
        const t = document.querySelector('[aria-controls="${dr.panel}"]');
        t.click();
        const panel = document.getElementById('${dr.panel}');
        const vis = getComputedStyle(panel).display !== 'none' && getComputedStyle(panel).visibility !== 'hidden';
        return { vis, focusInside: panel.contains(document.activeElement) };
    })()`);
    probe('drawer opens on trigger click', r1.vis);
    probe('focus moves inside the drawer on open', r1.focusInside);
    const r2 = await evaljs(`(() => {
        const panel = document.getElementById('${dr.panel}');
        const others = [...document.body.children].filter((el) => el !== panel && !panel.contains(el) && !['SCRIPT', 'STYLE'].includes(el.tagName));
        const covered = others.every((el) => el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none');
        return { covered };
    })()`);
    probe('content behind the open drawer is unreachable (inert/aria-hidden/hidden)', r2.covered, 'else keyboard and screen readers wander behind the overlay');
    await pressKey('Escape', 'Escape', 27);
    const r3 = await evaljs(`(() => {
        const panel = document.getElementById('${dr.panel}');
        return { vis: getComputedStyle(panel).display !== 'none' && getComputedStyle(panel).visibility !== 'hidden', active: document.activeElement ? document.activeElement.dataset.vpNav : null };
    })()`);
    probe('Escape closes the drawer', !r3.vis);
    probe('focus returns to the pre-open element after Escape', r3.active === preOpen, `focus on nav-${r3.active}, expected nav-${preOpen}`);
}

// ---------- Sticky/fixed header occlusion ----------
// A sticky or fixed header must not cover focused elements or in-page anchor
// targets. Pages without a sticky/fixed top bar skip silently (sticky is a
// choice, not a requirement).
const sticky = await evaljs(`(() => {
    const cand = [...document.querySelectorAll('body *')].filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'sticky' && cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        return r.top <= 1 && r.height > 0 && r.width >= window.innerWidth * 0.5;
    });
    if (!cand.length) return null;
    cand.forEach((el, i) => el.dataset.vpSticky = String(i));
    return { count: cand.length, height: Math.max(...cand.map((el) => el.getBoundingClientRect().height)) };
})()`);
if (sticky) {
    const occluded = await evaljs(`(async () => {
        const bars = [...document.querySelectorAll('[data-vp-sticky]')];
        const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
            .filter((el) => !el.disabled && el.tabIndex >= 0 && !bars.some((b) => b.contains(el)));
        const hits = [];
        for (const el of focusables) {
            // browsers may align a scrolled-to element at the top or bottom edge; check both
            for (const block of ['start', 'end']) {
                el.scrollIntoView({ block, behavior: 'instant' });
                await new Promise((r) => setTimeout(r, 50));
                const r = el.getBoundingClientRect();
                const barRects = bars.map((b) => b.getBoundingClientRect());
                for (const br of barRects) {
                    const overlap = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top);
                    if (overlap > 2) {
                        hits.push((el.innerText || el.id || el.tagName).trim().slice(0, 30) + ' @' + block);
                        break;
                    }
                }
            }
        }
        window.scrollTo(0, 0);
        return { checked: focusables.length, hits };
    })()`);
    probe('sticky/fixed header shows no focus-occlusion risk (modeled scroll alignment)', occluded.hits.length === 0,
        `${occluded.checked} focusable elements scrolled to top/bottom edge via scrollIntoView${occluded.hits.length ? '; at risk: ' + occluded.hits.join(', ') : ''} - modeled alignment, not a native Tab walk: confirm by keyboard before treating as a definitive failure; fix with scroll-padding-top`);
    const anchors = await evaljs(`(async () => {
        const bar = document.querySelector('[data-vp-sticky]');
        const links = [...document.querySelectorAll('a[href^="#"]')].filter((a) => a.getAttribute('href').length > 1 && !bar.contains(a));
        const hits = [];
        for (const a of links) {
            const target = document.getElementById(a.getAttribute('href').slice(1));
            if (!target) continue;
            a.click();
            await new Promise((r) => setTimeout(r, 150));
            const tr = target.getBoundingClientRect();
            const br = bar.getBoundingClientRect();
            if (tr.top < br.bottom - 2 && tr.bottom > br.top + 2) hits.push('#' + target.id);
        }
        return { checked: links.length, hits };
    })()`);
    probe('in-page anchor targets land below the sticky header', anchors.hits.length === 0,
        `${anchors.checked} anchors clicked via JS with 150ms settle wait${anchors.hits.length ? '; hidden under header: ' + anchors.hits.join(', ') : ''} - instant scroll-behavior assumed; a smooth-scrolling page may need a longer wait; fix with scroll-padding-top or scroll-margin-top`);
}

// ---------- content-driven collapse probe: do nav links crowd at 360px with no collapse control? ----------
await page('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: true });
await new Promise((r) => setTimeout(r, 300));
const crowd = await evaljs(`(() => {
    const vis = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    let scope = null, links = [];
    for (const n of document.querySelectorAll('header nav, header, nav')) {
        const ls = [...n.querySelectorAll('a[href]')].filter(vis);
        if (ls.length >= 3) { scope = n; links = ls; break; }
    }
    const buttons = [...document.querySelectorAll('button, [role="button"], summary')].filter((el) => vis(el) && el.getBoundingClientRect().width <= 120);
    const labeled = (el) => /menu|hamburger|nav|\\bopen\\b/.test(((el.getAttribute('aria-label') || '') + ' ' + el.textContent + ' ' + (el.className.baseVal !== undefined ? el.className.baseVal : el.className)).toLowerCase());
    const control = buttons.some(labeled);
    const unlabeledControl = !control && buttons.length > 0;
    if (!scope) return control
        ? { applicable: true, collapsed: true, crowded: false, hasControl: true }
        : unlabeledControl ? { applicable: false } : { applicable: false };
    const rects = links.map((el) => el.getBoundingClientRect());
    let overlap = false;
    for (let i = 0; i < rects.length && !overlap; i++)
        for (let j = i + 1; j < rects.length; j++) {
            const ox = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
            const oy = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
            if (ox > 2 && oy > 2) { overlap = true; break; }
        }
    const overflow = scope.scrollWidth > scope.clientWidth + 4;
    const rows = new Set(rects.map((r) => Math.round(r.top))).size > 1;
    return { applicable: true, linkCount: links.length, overlap, overflow, wrapped: rows, crowded: overlap || overflow, hasControl: control, unlabeledControl };
})()`);
await page('Emulation.clearDeviceMetricsOverride');
if (crowd.applicable) {
    // The observed defect is the overlap/overflow itself, never the absence of a
    // hamburger: wrapping, fewer links or smaller type are equally valid fixes.
    const observed = crowd.overlap ? 'overlap each other' : 'overflow their bar (content clipped or unreachable)';
    probe('nav links do not crowd at 360px (collapse control or they fit)', !crowd.crowded,
        crowd.crowded
            ? crowd.hasControl
                ? `${crowd.linkCount} nav links ${observed} at 360px while a menu control is also visible - links and control shown at once`
                : crowd.unlabeledControl
                    ? `${crowd.linkCount} nav links ${observed} at 360px; a small button is present but has no accessible name (aria-label or text) - if it is the collapse control, name it; either way the crowding needs a fix (fewer links, smaller type, wrapping, or a collapse)`
                    : `${crowd.linkCount} nav links ${observed} at 360px and no collapse control found - fix by reducing link count/size, allowing wrap, or swapping to a menu control`
            : crowd.collapsed ? 'nav collapses to a labeled menu control at 360px - no crowding' : `${crowd.linkCount} nav links fit at 360px${crowd.hasControl ? ' (a labeled menu control is also visible - check both are not shown at once by eye)' : ''}`);
}

if (!results.length) {
    console.log('MANUAL REVIEW: no [aria-controls] dropdown/drawer hooks, no sticky/fixed header, and no 3+-link nav found - nothing probeable, check any interactive nav behavior by hand.');
    await kill();
    process.exit(3);
}
const fails = results.filter((r) => !r.ok).length;
console.log('---');
console.log(`nav probes: ${results.length - fails}/${results.length} pass, ${fails} fail`);
await kill();
process.exit(fails ? 1 : 0);
