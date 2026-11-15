// Minimal Chrome DevTools Protocol driver over the remote-debugging pipe (stdio 3/4).
// Used by validate-page.mjs. No npm dependencies.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CALL_TIMEOUT_MS = 30000;

export function findChrome() {
    const candidates = [process.env.CHROME_BIN, 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean);
    for (const name of candidates) {
        try {
            const probe = spawn(name, ['--version'], { stdio: 'ignore' });
            return new Promise((resolve, reject) => {
                probe.on('error', () => reject(new Error('not found')));
                probe.on('exit', (code) => (code === 0 ? resolve(name) : reject(new Error('bad exit'))));
            }).catch(() => null).then((ok) => ok);
        } catch { /* next */ }
    }
    return Promise.resolve(null);
}

export async function resolveChrome() {
    for (const name of [process.env.CHROME_BIN, 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean)) {
        const ok = await new Promise((resolve) => {
            const probe = spawn(name, ['--version'], { stdio: 'ignore' });
            probe.on('error', () => resolve(false));
            probe.on('exit', (code) => resolve(code === 0));
        });
        if (ok) return name;
    }
    throw new Error('No Chrome/Chromium binary found. Set CHROME_BIN.');
}

class DevTools {
    constructor(writable, readable) {
        this.writable = writable;
        this.pending = new Map();
        this.listeners = [];
        this.nextId = 1;
        this.exited = null;
        const pieces = [];
        writable.on('error', () => {});
        readable.on('error', () => {});
        readable.setEncoding('utf8');
        readable.on('data', (chunk) => {
            let start = 0;
            for (let end = chunk.indexOf('\0'); end !== -1; end = chunk.indexOf('\0', start)) {
                pieces.push(chunk.slice(start, end));
                start = end + 1;
                const message = JSON.parse(pieces.join(''));
                pieces.length = 0;
                this.dispatch(message);
            }
            if (start < chunk.length) pieces.push(chunk.slice(start));
        });
        const firstPage = this.waitFor('Target.targetCreated', undefined, ({ targetInfo }) => targetInfo.type === 'page');
        this.started = Promise.all([withTimeout(firstPage, 30000, 'Chrome opened no window within 30s'), this.send('Target.setDiscoverTargets', { discover: true })]);
        this.started.catch(() => {});
    }
    dispatch(message) {
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (!pending) return;
            if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
            else pending.resolve(message.result);
            return;
        }
        this.listeners = this.listeners.filter((l) => !(l.method === message.method && (l.sessionId === undefined || l.sessionId === message.sessionId) && l.accepts(message.params) && (l.resolve(message.params), true)));
    }
    abort(sessionId, message) {
        for (const [id, p] of this.pending) if (sessionId === undefined || p.sessionId === sessionId) { this.pending.delete(id); p.reject(new Error(`${p.method}: ${message}`)); }
        this.listeners = this.listeners.filter((l) => !((sessionId === undefined || l.sessionId === sessionId) && (l.reject(new Error(`${l.method}: ${message}`)), true)));
    }
    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        if (this.exited) return Promise.reject(new Error(`${method}: ${this.exited}`));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer within ${CALL_TIMEOUT_MS / 1000}s`)); }, CALL_TIMEOUT_MS);
            timer.unref();
            this.pending.set(id, { method, sessionId, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
            this.writable.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
        });
    }
    async openPage() {
        await this.started;
        const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
        await this.send('Inspector.enable', {}, sessionId);
        let crashed = false;
        this.on_crash = () => {};
        const page = (method, params) => (crashed ? Promise.reject(new Error('page crashed')) : this.send(method, params, sessionId));
        return { targetId, sessionId, page };
    }
    waitFor(method, sessionId, accepts = () => true) {
        if (this.exited) return Promise.reject(new Error(`${method}: ${this.exited}`));
        return new Promise((resolve, reject) => this.listeners.push({ method, sessionId, accepts, resolve, reject }));
    }
    closed(detail) {
        if (this.exited) return;
        this.exited = `browser exited. ${String(detail).trim().split('\n').filter((l) => !/dbus|GLib|Fontconfig/.test(l)).slice(-3).join(' ')}`.trim();
        this.abort(undefined, this.exited);
    }
}

export function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}

export async function launchChrome() {
    const binary = await resolveChrome();
    const profileDir = mkdtempSync('/tmp/validate-chrome-');
    writeFileSync(path.join(profileDir, 'owner'), String(process.pid));
    const flags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--disable-dev-shm-usage', '--allow-file-access-from-files', `--user-data-dir=${path.join(profileDir, 'profile')}`, '--remote-debugging-pipe', 'about:blank'];
    const env = Object.fromEntries(Object.entries(process.env).filter(([n]) => n !== 'LD_PRELOAD' && !n.startsWith('FAKETIME')));
    const proc = spawn(binary, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: true, env });
    const cdp = new DevTools(proc.stdio[3], proc.stdio[4]);
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c; });
    let gone;
    const stopped = new Promise((r) => { gone = r; });
    proc.on('error', (e) => { cdp.closed(e.message); gone(); });
    proc.on('exit', () => { cdp.closed(stderr); gone(); });
    let killed = false;
    const kill = () => { if (!killed) { killed = true; try { process.kill(-proc.pid, 'SIGKILL'); } catch {} } return stopped; };
    process.on('exit', kill);
    return { cdp, kill };
}
