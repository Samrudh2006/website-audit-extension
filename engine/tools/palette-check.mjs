// palette-check.mjs - WCAG 2.2 contrast for a palette, no browser needed.
//
//   node tools/palette-check.mjs palette.json
//
// palette.json:
//   {
//     "text_pairs":   [{ "name": "body on paper", "fg": "#241F1C", "bg": "#FAF7F2", "large": false }],
//     "ui_pairs":     [{ "name": "focus ring on paper", "fg": "#C29A3B", "bg": "#FAF7F2" }],
//     "series":       [{ "name": "ok", "hex": "#246B45" }, { "name": "warn", "hex": "#9A4F04" }]
//   }
//
// Thresholds (SC 1.4.3 / 1.4.11): normal text 4.5:1, large text 3:1
// (large = at least 24px, or 18.66px bold, WCAG point sizes are authoritative),
// UI components and meaningful graphics 3:1 against adjacent colors.
// "series" prints the pairwise matrix so chart-color adjacency can be judged;
// adjacent series colors that must be told apart should reach 3:1 OR the chart
// needs a non-color channel (labels, patterns, direct annotation). A ratio under
// 3:1 is reported as 'weak', not failed - WCAG does not set a series-pair number.
//
// Hex handling: #RGB and #RRGGBB accepted. 8-digit #RRGGBBAA is supported by
// alpha-compositing the color over the pair's background (over #FFFFFF for
// series colors) and the composite is noted in the output. Anything else
// (bad length, non-hex digits) is rejected with an error and exit code 2 -
// malformed input is never silently scored.
const [file] = process.argv.slice(2);
if (!file) { console.error('Usage: node tools/palette-check.mjs palette.json'); process.exit(2); }
const data = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));

class HexError extends Error {}

const hex = (h, context) => {
    if (typeof h !== 'string') throw new HexError(`${context}: expected a hex string, got ${JSON.stringify(h)}`);
    const m = h.replace(/^#/, '');
    if (!/^[0-9a-fA-F]+$/.test(m)) throw new HexError(`${context}: '${h}' contains non-hex characters`);
    const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
    if (v.length !== 6 && v.length !== 8) throw new HexError(`${context}: '${h}' must be #RGB, #RRGGBB or #RRGGBBAA`);
    return {
        r: parseInt(v.slice(0, 2), 16),
        g: parseInt(v.slice(2, 4), 16),
        b: parseInt(v.slice(4, 6), 16),
        a: v.length === 8 ? parseInt(v.slice(6, 8), 16) / 255 : 1,
        hadAlpha: v.length === 8,
    };
};
const over = (top, bottom) => ({
    r: Math.round(top.r * top.a + bottom.r * (1 - top.a)),
    g: Math.round(top.g * top.a + bottom.g * (1 - top.a)),
    b: Math.round(top.b * top.a + bottom.b * (1 - top.a)),
    a: 1,
});
const lum = ({ r, g, b }) => {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

// Resolve a pair's fg/bg to opaque composites. Alpha composited over the pair bg;
// bg alpha (rare) composited over white and noted.
const resolvePair = (p) => {
    const ctx = `pair '${p.name || '(unnamed)'}'`;
    const bgRaw = hex(p.bg, `${ctx} bg`);
    const bg = bgRaw.hadAlpha ? over(bgRaw, { r: 255, g: 255, b: 255 }) : bgRaw;
    const fgRaw = hex(p.fg, `${ctx} fg`);
    const fg = fgRaw.hadAlpha ? over(fgRaw, bg) : fgRaw;
    const notes = [];
    if (fgRaw.hadAlpha) notes.push(`fg alpha ${fgRaw.a.toFixed(2)} composited over bg`);
    if (bgRaw.hadAlpha) notes.push('bg alpha composited over #FFFFFF');
    return { fg, bg, note: notes.length ? ` (${notes.join('; ')})` : '' };
};
const ratioPair = ({ fg, bg }) => {
    const la = lum(fg), lb = lum(bg);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

let failures = 0;
try {
    for (const p of data.text_pairs || []) {
        const need = p.large ? 3.0 : 4.5;
        const { note, ...pair } = resolvePair(p);
        const r = ratioPair(pair);
        const ok = r + 1e-9 >= need;
        if (!ok) failures++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${p.name}: ${r.toFixed(2)}:1 (needs ${need}:1${p.large ? ', large text' : ''})${note}`);
    }
    for (const p of data.ui_pairs || []) {
        const { note, ...pair } = resolvePair(p);
        const r = ratioPair(pair);
        const ok = r + 1e-9 >= 3.0;
        if (!ok) failures++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${p.name}: ${r.toFixed(2)}:1 (needs 3:1, SC 1.4.11)${note}`);
    }
    const series = (data.series || []).map((s) => {
        const c = hex(s.hex, `series '${s.name || '(unnamed)'}'`);
        const opaque = c.hadAlpha ? over(c, { r: 255, g: 255, b: 255 }) : c;
        return { name: s.name, c: opaque, note: c.hadAlpha ? ' alpha composited over #FFFFFF' : '' };
    });
    if (series.length > 1) {
        console.log('\nseries pairwise (weak = under 3:1; add a non-color channel if adjacent):');
        for (let i = 0; i < series.length; i++) {
            for (let j = i + 1; j < series.length; j++) {
                const r = ratioPair({ fg: series[i].c, bg: series[j].c });
                const alphaNote = series[i].note || series[j].note ? ' (alpha composited over #FFFFFF)' : '';
                console.log(`${r >= 3 ? 'ok  ' : 'weak'}  ${series[i].name} vs ${series[j].name}: ${r.toFixed(2)}:1${alphaNote}`);
            }
        }
    }
} catch (e) {
    if (e instanceof HexError) { console.error(`INVALID HEX: ${e.message}`); process.exit(2); }
    throw e;
}
process.exit(failures ? 1 : 0);
