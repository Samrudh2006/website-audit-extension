// Self-test for real network interception in validate-page --offline.
// Starts a local WebSocket echo server (deterministic - no external service),
// loads the fixture with ?ws= pointing at it, and prints window.__net.
// ONLINE run expects fetch 'ok' (needs internet) and ws 'ok'; OFFLINE run
// expects both 'blocked'. Worker scripts are NOT probed: remote workers are
// same-origin-blocked regardless, so a block proves nothing.
import { launchChrome } from '../chrome-cdp.mjs';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const offline = args.includes('--offline');

// minimal RFC6455 handshake-only server
const wsServer = createServer();
wsServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('error', () => {});
});
await new Promise((r) => wsServer.listen(0, '127.0.0.1', r));
const wsUrl = `ws://127.0.0.1:${wsServer.address().port}/`;

const url = pathToFileURL(path.resolve(file)).href + '?ws=' + encodeURIComponent(wsUrl);
const { cdp, kill } = await launchChrome();
const { page } = await cdp.openPage();
await page('Page.enable');
await page('Runtime.enable');
if (offline) {
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    // CDP does not intercept WebSocket handshakes (measured: local echo still
    // connects through setBlockedURLs and Fetch.requestPaused never fires), so
    // page-JS WebSocket/EventSource construction is refused at new-document level.
    await page('Page.addScriptToEvaluateOnNewDocument', { source: 'window.WebSocket = undefined; window.EventSource = undefined;' });
}
const loaded = cdp.waitFor('Page.loadEventFired', undefined, () => true);
await page('Page.navigate', { url });
await loaded;
const { result } = await page('Runtime.evaluate', { expression: `new Promise((r) => { const t = () => document.title.startsWith('{') ? r(window.__net) : setTimeout(t, 200); t(); setTimeout(() => r(window.__net || null), 9000); })`, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify({ offline, net: result.value }));
await kill();
wsServer.close();
