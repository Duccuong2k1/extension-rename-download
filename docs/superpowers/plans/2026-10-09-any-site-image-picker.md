# Any-Site Image Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the extension pick images from any page (or pasted links), optionally convert them to PNG/JPG/WebP, and download them renamed in order.

**Architecture:** The popup scans the active tab (`collectImages` on Flow, new `collectPageImages` elsewhere), shows a checkbox grid or a paste box, and sends `{base, urls, tabId, format}` to the background. The background gets each image through one self-contained function `fetchImage(url, format)`: first injected into the tab (keeps the site's cookies), and if that fails, run in an offscreen document from the extension origin (bypasses CORS via `<all_urls>`). It then downloads the returned blob URL with the existing naming.

**Tech Stack:** Chrome MV3, plain ES modules, no build, no dependencies. Node 20 for unit tests, `playwright-core` (already installed globally under `@playwright/mcp`) for E2E.

**Spec:** `docs/superpowers/specs/2026-10-09-any-site-image-picker-design.md`

**Deviations from spec (deliberate, smaller):**
- `largestSrcset` and `mimeForFormat` do not go into `naming.js`: they are used only inside functions injected with `executeScript`, which must be self-contained. So they live inline in `collectPageImages` and `fetchImage`, and the E2E covers them.
- Collectors return plain URL strings. The popup reads each thumbnail's natural size when it loads, so there is no `{w, h}` plumbing.
- Conversion decodes with `new Image()` + `decode()` instead of `createImageBitmap`, because `createImageBitmap` cannot decode SVG.

## Global Constraints

- File names: `<base>-001.<ext>` in `Downloads/<base>/`, padding `Math.max(3, digits(total))` (existing `fileName`).
- Format options: `keep` (default), `png`, `jpg`, `webp`. JPG gets a white background and quality `0.92`.
- Pasted links are separated by any whitespace; keep `http(s)://` and `data:image/`, dedupe, keep order.
- On non-Flow pages, skip images under 50×50 and `data:` URLs shorter than 1400 chars. Order by page position (top, then left). No auto-scroll.
- Flow behavior stays unchanged (`collectImages` + `originalUrl`).
- Permissions: `downloads`, `scripting`, `activeTab`, `offscreen`; host `<all_urls>`.
- UI copy is Vietnamese, in sentence case. The popup keeps the existing dark tokens.

## Review Focus

1. **Page has hundreds of images** → popup stays responsive: thumbnails use `loading="lazy"` and the grid scrolls inside a fixed height (Task 4 E2E checks the grid renders and counts correctly).
2. **Cross-origin image without CORS headers** → still downloads via the offscreen fallback (Task 2 E2E).
3. **Pasted text with junk, duplicates, mixed spaces and newlines** → only valid unique links, in order (Task 1 unit test).
4. **Restricted page (`chrome://`)** → page tab shows a message and the paste tab still downloads (Task 4: unscriptable tabs make `executeScript` throw; the popup catches it and the background falls back to offscreen; the paste-tab E2E runs with a tab whose fetch fails).
5. **Format = keep but the server sends a non-image (HTML login page)** → counted as a failure, not saved as `.html` (Task 2: `fetchImage` throws when the response is not `image/*`; already covered by the Flow E2E 403 path).

Animated GIF converted to another format keeps only the first frame. This is accepted and noted in the code.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `naming.js` | modify | + `parseLinks(text)` |
| `naming.test.js` | modify | tests for `parseLinks` |
| `fetch-image.js` | create | `fetchImage(url, format)`: fetch, optional conversion, blob URL. Self-contained. |
| `offscreen.html` / `offscreen.js` | create | Runs `fetchImage` from the extension origin on request |
| `background.js` | modify | Two-step image source (tab, then offscreen), `format` param |
| `content.js` | modify | + `collectPageImages()` |
| `popup.html` / `popup.js` | modify | Tabs, grid, paste box, format select |
| `manifest.json` | modify | Permissions, generic name and description |
| `tests/e2e.cjs` | create | Flow mock, generic page with cross-origin image, paste links |
| `package.json` | modify | `test:e2e` script |

---

### Task 1: `parseLinks` helper

**Files:**
- Modify: `naming.js`
- Test: `naming.test.js`

**Interfaces:**
- Produces: `parseLinks(text: string): string[]`

- [ ] **Step 1: Write the failing test.** Append before the final `console.log` in `naming.test.js`, and add `parseLinks` to the import:

```js
assert.deepEqual(parseLinks('https://a.com/1.png https://b.com/2.jpg'), ['https://a.com/1.png', 'https://b.com/2.jpg']);
assert.deepEqual(parseLinks('  https://a.com/1.png\n\n\thttps://a.com/1.png\r\nhttp://c.com/x  '), ['https://a.com/1.png', 'http://c.com/x']);
assert.deepEqual(parseLinks('rác ftp://x.com/a.png javascript:alert(1) data:image/png;base64,AAAA'), ['data:image/png;base64,AAAA']);
assert.deepEqual(parseLinks(''), []);
```

- [ ] **Step 2: Run** `node naming.test.js`. Expected: FAIL (`parseLinks` is not exported).

- [ ] **Step 3: Implement** in `naming.js`:

```js
// Pasted links may be separated by any mix of spaces and newlines.
export function parseLinks(text) {
  return [...new Set(String(text ?? '').split(/\s+/).filter((s) => /^(https?:\/\/\S+|data:image\/)/i.test(s)))];
}
```

- [ ] **Step 4: Run** `node naming.test.js`. Expected: `naming tests passed`.

- [ ] **Step 5: Commit** `feat: parseLinks helper for pasted image links`.

---

### Task 2: Fetch + convert pipeline with offscreen fallback

**Files:**
- Create: `fetch-image.js`, `offscreen.html`, `offscreen.js`, `tests/e2e.cjs`
- Modify: `background.js`, `manifest.json`, `package.json`

**Interfaces:**
- Produces: `fetchImage(url: string, format: 'keep'|'png'|'jpg'|'webp'): Promise<{blobUrl: string, mime: string}>`. It throws on non-OK responses, non-image responses, or decode failure.
- Produces: message `{type:'start', base, urls, tabId?, format}` accepted by the background (`format` defaults to `keep`).
- Produces: message `{type:'offscreen-fetch', url, format}` → `{blobUrl, mime}` or `{error}`.

- [ ] **Step 1: Create `fetch-image.js`:**

```js
// Self-contained: injected into pages via executeScript and imported by offscreen.js.
export async function fetchImage(url, format) {
  const res = await fetch(url, { credentials: 'include' });
  let blob = await res.blob();
  if (!res.ok || !blob.type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${blob.type || 'unknown'}`);
  const target = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format];
  if (target && target !== blob.type) {
    // ponytail: animated GIF/WebP keep only the first frame when converted.
    const src = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 1024; // SVG without intrinsic size
      c.height = img.naturalHeight || 1024;
      const g = c.getContext('2d');
      if (target === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('convert failed'))), target, 0.92));
    } finally {
      URL.revokeObjectURL(src);
    }
  }
  const blobUrl = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60_000);
  return { blobUrl, mime: blob.type };
}
```

- [ ] **Step 2: Create `offscreen.html`:**

```html
<!doctype html>
<meta charset="utf-8">
<script type="module" src="offscreen.js"></script>
```

and `offscreen.js`:

```js
import { fetchImage } from './fetch-image.js';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'offscreen-fetch') return;
  fetchImage(msg.url, msg.format).then(reply, (e) => reply({ error: e.message }));
  return true; // async reply
});
```

- [ ] **Step 3: Update `background.js`.** Replace the inline `fetchAsBlobUrl` with an import, and add the two-step source:

```js
import { fileName, extFromMime } from './naming.js';
import { fetchImage } from './fetch-image.js';
```

Delete the `fetchAsBlobUrl` function. Add:

```js
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Fetch and convert images for download' });
}

// In the tab first (site cookies, e.g. Flow login); else from the extension origin (no CORS limits).
async function getImage(url, format, tabId) {
  if (tabId != null) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: fetchImage, args: [url, format] });
      if (result) return result;
    } catch {} // unscriptable tab: fall through
  }
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ type: 'offscreen-fetch', url, format });
  if (!r || r.error) throw new Error(r?.error || 'offscreen fetch failed');
  return r;
}
```

Change `run(base, urls, tabId)` to `run(base, urls, tabId, format)`, and replace its first two lines inside `try`:

```js
      const result = await getImage(url, format, tabId);
```

(the `if (!result) throw …` line is removed; `getImage` throws instead). In the message listener: `run(msg.base, msg.urls, msg.tabId, msg.format || 'keep');`

- [ ] **Step 4: Update `manifest.json`:**

```json
{
  "manifest_version": 3,
  "name": "Image Bulk Rename & Download",
  "version": "2.0.0",
  "description": "Chọn ảnh trên trang hoặc dán link, đổi định dạng, tải về và đổi tên theo thứ tự.",
  "permissions": ["downloads", "scripting", "activeTab", "offscreen"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "Image Bulk Rename & Download" }
}
```

- [ ] **Step 5: Create `tests/e2e.cjs`** (the harness from the scratchpad, made repo-relative and with local servers for the generic cases). Scenario A: the Flow mock driven through background messages (the popup UI comes in Task 4). Scenario B: a generic page plus a cross-origin image converted to PNG.

```js
// E2E: node tests/e2e.cjs   (needs Chromium from ms-playwright; override with CHROME=...)
const { chromium } = require(process.env.PW_CORE || 'C:/Program Files/nodejs/node_modules/@playwright/mcp/node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const assert = require('assert/strict');
const EXT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1228/chrome-win64/chrome.exe');

const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const isPng = (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const FLOW_N = 5;
const flowHtml = `<!doctype html><body style="margin:0"><div class="cdk-virtual-scrollable" style="height:400px;overflow:auto">
${Array.from({ length: FLOW_N }, (_, i) => `<div class="container" style="height:300px"><img class="image" src="https://flow.google.com/asb/IMG${i}=s1600-rw?authuser=0" style="width:200px;height:200px"></div>`).join('')}
</div></body>`;

// Two origins: the page (localhost:A) and a CDN without CORS headers (127.0.0.1:B).
function serve(handler) {
  return new Promise((ok) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => ok(s)); });
}

(async () => {
  const cdn = await serve((req, res) => {
    res.writeHead(200, { 'content-type': req.url.endsWith('.png') ? 'image/png' : 'image/jpeg' });
    res.end(req.url.endsWith('.png') ? PNG : JPG);
  });
  const CDN = `http://127.0.0.1:${cdn.address().port}`;
  const site = await serve((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><body>
        <img id="srcset" src="/small.jpg" srcset="/small.jpg 1x, /big.jpg 2x" width="200" height="200">
        <div id="bg" style="width:200px;height:200px;background-image:url('/bg.jpg')"></div>
        <img id="icon" src="/icon.png" width="16" height="16">
        <img id="cross" src="${CDN}/cross.png" width="200" height="200">
      </body>`);
    }
    res.writeHead(200, { 'content-type': req.url.endsWith('.png') ? 'image/png' : 'image/jpeg' });
    res.end(req.url.endsWith('.png') ? PNG : JPG);
  });
  const SITE = `http://localhost:${site.address().port}`;

  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dl-'));
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prof-'));
  fs.mkdirSync(path.join(prof, 'Default'));
  fs.writeFileSync(path.join(prof, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: dl, prompt_for_download: false } }));
  const proc = require('child_process').spawn(CHROME, [`--user-data-dir=${prof}`, '--remote-debugging-port=9333', '--no-first-run',
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'about:blank']);
  let browser;
  for (let t = 0; t < 40 && !browser; t++) { await new Promise((r) => setTimeout(r, 500)); browser = await chromium.connectOverCDP('http://127.0.0.1:9333').catch(() => null); }
  const ctx = browser.contexts()[0];
  await (await browser.newBrowserCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'default' });
  await ctx.addCookies([{ name: 'auth', value: '1', domain: 'flow.google.com', path: '/', secure: true, sameSite: 'Lax' }]);
  await ctx.route('https://flow.google.com/**', (route) => {
    const u = route.request().url();
    if (u.includes('/project/')) return route.fulfill({ contentType: 'text/html', body: flowHtml });
    const m = u.match(/IMG(\d+)=(s1600-rw|d)\?authuser=0$/);
    if (!m || !(route.request().headers().cookie || '').includes('auth=1')) return route.fulfill({ status: 403 });
    const png = Number(m[1]) % 2 === 1;
    route.fulfill({ contentType: png ? 'image/png' : 'image/jpeg', body: png ? PNG : JPG });
  });

  const isOurs = (w) => w.url().endsWith('/background.js');
  const sw = ctx.serviceWorkers().find(isOurs) || await ctx.waitForEvent('serviceworker', { predicate: isOurs });
  const extId = sw.url().split('/')[2];
  const files = (base) => (fs.existsSync(path.join(dl, base)) ? fs.readdirSync(path.join(dl, base)).sort() : []);
  const waitFiles = async (base, n) => { for (let t = 0; t < 60 && files(base).filter((f) => !f.endsWith('.crdownload')).length < n; t++) await new Promise((r) => setTimeout(r, 500)); return files(base); };
  const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);

  const flow = await ctx.newPage();
  await flow.goto('https://flow.google.com/project/test');
  const site1 = await ctx.newPage();
  await site1.goto(SITE + '/');

  const ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${extId}/offscreen.html`); // any extension page can send messages

  // A: Flow via background message.
  const flowTab = await tabIdOf('https://flow.google.com/project/*');
  await ext.evaluate(async ({ tabId }) => {
    const { collectImages } = await import('./content.js');
    const { originalUrl } = await import('./naming.js');
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: collectImages });
    await chrome.runtime.sendMessage({ type: 'start', base: 'flow', urls: result.map(originalUrl), tabId, format: 'keep' });
  }, { tabId: flowTab });
  assert.deepEqual(await waitFiles('flow', FLOW_N), ['flow-001.jpg', 'flow-002.png', 'flow-003.jpg', 'flow-004.png', 'flow-005.jpg']);
  console.log('A flow: ok');

  // B: same-origin + cross-origin (no CORS) images, converted to PNG.
  const siteTab = await tabIdOf(SITE + '/*');
  await ext.evaluate(async ({ tabId, urls }) => {
    await chrome.runtime.sendMessage({ type: 'start', base: 'conv', urls, tabId, format: 'png' });
  }, { tabId: siteTab, urls: [SITE + '/big.jpg', CDN + '/cross.png', CDN + '/other.jpg'] });
  const conv = await waitFiles('conv', 3);
  assert.deepEqual(conv, ['conv-001.png', 'conv-002.png', 'conv-003.png']);
  for (const f of conv) assert.ok(isPng(fs.readFileSync(path.join(dl, 'conv', f))), f + ' is not a real PNG');
  console.log('B convert + cross-origin: ok');

  console.log('E2E PASS');
  proc.kill(); cdn.close(); site.close();
  process.exit(0);
})().catch((e) => { console.error('E2E FAIL', e); process.exit(1); });
```

Note: the message `start` is rejected while a run is in progress, and `waitFiles` waits for the files to land before scenario B starts, so the two runs never overlap.

- [ ] **Step 6: Add the script** to `package.json`: `"test:e2e": "node tests/e2e.cjs"`.

- [ ] **Step 7: Run** `npm test && npm run test:e2e`. Expected: `naming tests passed`, then `A flow: ok`, `B convert + cross-origin: ok`, `E2E PASS`. To see the fallback is needed, temporarily comment out the offscreen lines in `getImage`: `CDN + '/cross.png'` must then fail (scenario B times out). Restore.

- [ ] **Step 8: Commit** `feat: fetch/convert pipeline with offscreen fallback for any site`.

---

### Task 3: `collectPageImages`

**Files:**
- Modify: `content.js`, `tests/e2e.cjs`

**Interfaces:**
- Produces: `collectPageImages(): string[]`. Absolute URLs in page order (self-contained, injectable).

- [ ] **Step 1: Write the failing E2E check.** Insert before `console.log('E2E PASS')`:

```js
  // C: page scan picks srcset's biggest, CSS background, cross-origin; skips the 16px icon.
  const scanned = await ext.evaluate(async ({ tabId }) => {
    const { collectPageImages } = await import('./content.js');
    return (await chrome.scripting.executeScript({ target: { tabId }, func: collectPageImages }))[0].result;
  }, { tabId: siteTab });
  assert.deepEqual(scanned, [SITE + '/big.jpg', SITE + '/bg.jpg', CDN + '/cross.png']);
  console.log('C page scan: ok');
```

- [ ] **Step 2: Run** `npm run test:e2e`. Expected: FAIL (`collectPageImages` is not a function).

- [ ] **Step 3: Implement.** Append to `content.js`:

```js
// Injected via executeScript — must stay self-contained. Returns absolute URLs in page order.
export function collectPageImages() {
  const found = new Map();
  const add = (url, el, w = 0, h = 0) => {
    let href;
    try { href = new URL(url, location.href).href; } catch { return; }
    if (!/^(https?:|data:image\/)/.test(href) || found.has(href)) return;
    if (href.startsWith('data:') && href.length < 1400) return; // inline icons / placeholders
    const r = el.getBoundingClientRect();
    if ((w || r.width) < 50 || (h || r.height) < 50) return;
    found.set(href, { y: r.top + scrollY, x: r.left + scrollX });
  };
  for (const img of document.images) {
    // ponytail: comma split breaks on srcset URLs containing commas (rare CDNs).
    const best = (img.srcset || '').split(',').map((s) => s.trim().split(/\s+/)).filter(([u]) => u)
      .map(([u, d = '1x']) => [u, parseFloat(d) || 1]).sort((a, b) => b[1] - a[1])[0]?.[0];
    add(best || img.currentSrc || img.src, img, img.naturalWidth, img.naturalHeight);
  }
  for (const el of document.querySelectorAll('body *')) {
    for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(m[1], el);
  }
  return [...found].sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([href]) => href);
}
```

- [ ] **Step 4: Run** `npm run test:e2e`. Expected: `C page scan: ok`, `E2E PASS`.

- [ ] **Step 5: Commit** `feat: collect images on any page (img, srcset, CSS backgrounds)`.

---

### Task 4: Popup with tabs, grid, paste box, format select

**Files:**
- Modify: `popup.html`, `popup.js`, `tests/e2e.cjs`

**Interfaces:**
- Consumes: `collectImages`, `collectPageImages` (content.js); `sanitize`, `originalUrl`, `parseLinks` (naming.js); message `start` with `format`.
- Test hook: `popup.html?tab=<id>` targets that tab instead of the active one (E2E opens the popup as a tab).
- Element ids used by E2E: `#tab-page`, `#tab-paste`, `#grid` (tiles `label.tile input[type=checkbox]`), `#count`, `#toggle-all`, `#links`, `#link-count`, `#base`, `#format`, `#start`, `#status`.

- [ ] **Step 1: Write the failing E2E check.** Insert before `console.log('E2E PASS')`:

```js
  // D: popup UI on the generic page: grid, uncheck one, JPG, download.
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/popup.html?tab=${siteTab}`);
  await pop.waitForFunction(() => document.querySelectorAll('#grid .tile').length === 3);
  assert.equal(await pop.textContent('#count'), 'Đã chọn 3 / 3');
  await pop.click('#grid .tile:nth-child(2)'); // drop the CSS background
  assert.equal(await pop.textContent('#count'), 'Đã chọn 2 / 3');
  await pop.fill('#base', 'ui');
  await pop.selectOption('#format', 'jpg');
  await pop.click('#start');
  assert.deepEqual(await waitFiles('ui', 2), ['ui-001.jpg', 'ui-002.jpg']);
  await pop.waitForFunction(() => /^Đã tải 2 \/ 2/.test(document.querySelector('#status').textContent));
  console.log('D popup grid: ok');

  // E: paste tab with junk and duplicates, keep format.
  await pop.click('#tab-paste');
  await pop.fill('#links', `${CDN}/p1.png   rác\n${CDN}/p2.jpg\n${CDN}/p1.png`);
  assert.equal(await pop.textContent('#link-count'), '2 link hợp lệ');
  await pop.fill('#base', 'dan');
  await pop.selectOption('#format', 'keep');
  await pop.click('#start');
  assert.deepEqual(await waitFiles('dan', 2), ['dan-001.png', 'dan-002.jpg']);
  console.log('E paste links: ok');
```

- [ ] **Step 2: Run** `npm run test:e2e`. Expected: FAIL (timeout waiting for `#grid .tile`).

- [ ] **Step 3: Replace `popup.html`** (same tokens, wider body, new controls):

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --bg: #17181c; --surface: #22242a; --line: #34363d; --text: #ecebf0;
      --muted: #9a9ba6; --accent: #a8b4ff; --on-accent: #15172a; --bad: #ff9a8f;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body {
      width: 400px; margin: 0; padding: 16px 16px 14px;
      background: var(--bg); color: var(--text);
      font: 14px/1.45 "Google Sans Text", "Google Sans", "Segoe UI Variable Text", system-ui, sans-serif;
    }
    h1 { margin: 0 0 12px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    label.field { display: block; margin-bottom: 6px; color: var(--muted); font-size: 13px; }
    input[type=text], select, textarea {
      width: 100%; padding: 9px 11px; border-radius: 10px;
      border: 1px solid var(--line); background: var(--surface); color: var(--text);
      font: inherit; outline: none;
    }
    input[type=text]:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--accent); }
    input::placeholder, textarea::placeholder { color: #6c6d77; }

    [role=tablist] { display: flex; gap: 4px; padding: 3px; margin-bottom: 10px; border-radius: 999px; background: var(--surface); }
    [role=tab] {
      flex: 1; padding: 7px; border: 0; border-radius: 999px; background: none;
      color: var(--muted); font: inherit; font-size: 13px; cursor: pointer;
    }
    [role=tab][aria-selected=true] { background: var(--line); color: var(--text); }
    [role=tab]:focus-visible { outline: 2px solid var(--accent); }

    .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; color: var(--muted); }
    .link { border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; padding: 0; }
    .link:focus-visible { outline: 2px solid var(--accent); }
    .grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
      max-height: 264px; overflow-y: auto; margin-bottom: 12px;
    }
    .grid:empty { display: none; }
    .tile {
      position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
      background: var(--surface); cursor: pointer; outline: 2px solid transparent; outline-offset: -2px;
    }
    .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile input { position: absolute; top: 6px; left: 6px; margin: 0; accent-color: var(--accent); width: 16px; height: 16px; }
    .tile:has(input:checked) { outline-color: var(--accent); }
    .tile:not(:has(input:checked)) img { opacity: .35; }
    .tile:has(input:focus-visible) { outline-color: var(--text); }
    .tile .num, .tile .dim {
      position: absolute; padding: 1px 6px; border-radius: 6px;
      background: rgb(23 24 28 / .8); font-size: 11px; font-variant-numeric: tabular-nums;
    }
    .tile .num { top: 5px; right: 5px; color: var(--accent); font-weight: 600; }
    .tile .num:empty { display: none; }
    .tile .dim { bottom: 5px; left: 5px; color: var(--muted); }
    .tile .dim:empty { display: none; }
    textarea { height: 140px; resize: vertical; font-size: 12px; line-height: 1.5; }
    .hint { margin: 6px 0 12px; color: var(--muted); font-size: 12px; }

    .row { display: grid; grid-template-columns: 1fr 120px; gap: 8px; }
    .preview {
      margin: 10px 0 12px; padding: 9px 11px; border-radius: 10px;
      background: var(--surface); font-variant-numeric: tabular-nums;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .preview b { color: var(--accent); font-weight: 600; }
    .preview span { color: var(--muted); }

    #start {
      width: 100%; padding: 11px; border: 0; border-radius: 999px;
      background: var(--accent); color: var(--on-accent);
      font: inherit; font-weight: 600; cursor: pointer; transition: filter .15s, opacity .15s;
    }
    #start:hover:not(:disabled) { filter: brightness(1.08); }
    #start:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
    #start:disabled { opacity: .45; cursor: default; }

    .progress { margin-top: 12px; }
    .progress[hidden] { display: none; }
    progress { appearance: none; width: 100%; height: 6px; border: 0; border-radius: 999px; background: var(--surface); overflow: hidden; display: block; }
    progress::-webkit-progress-bar { background: var(--surface); }
    progress::-webkit-progress-value { background: var(--accent); border-radius: 999px; transition: width .2s; }
    #status { margin: 8px 0 0; font-size: 13px; font-variant-numeric: tabular-nums; }
    #status.bad { color: var(--bad); }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  </style>
</head>
<body>
  <h1>Tải ảnh và đổi tên</h1>
  <div role="tablist">
    <button role="tab" id="tab-page" aria-selected="true" aria-controls="panel-page">Ảnh trên trang</button>
    <button role="tab" id="tab-paste" aria-selected="false" aria-controls="panel-paste">Dán link</button>
  </div>

  <section id="panel-page" role="tabpanel" aria-labelledby="tab-page">
    <div class="bar"><span id="count" aria-live="polite">Đang tìm ảnh trên trang…</span><button class="link" id="toggle-all" hidden>Bỏ chọn tất cả</button></div>
    <div class="grid" id="grid"></div>
  </section>

  <section id="panel-paste" role="tabpanel" aria-labelledby="tab-paste" hidden>
    <label class="field" for="links">Link ảnh</label>
    <textarea id="links" placeholder="Dán link ảnh, cách nhau bằng dấu cách hoặc xuống dòng"></textarea>
    <p class="hint" id="link-count" aria-live="polite">0 link hợp lệ</p>
  </section>

  <div class="row">
    <div>
      <label class="field" for="base">Tên file</label>
      <input type="text" id="base" placeholder="anh" autocomplete="off">
    </div>
    <div>
      <label class="field" for="format">Định dạng</label>
      <select id="format">
        <option value="keep">Giữ nguyên</option>
        <option value="png">PNG</option>
        <option value="jpg">JPG</option>
        <option value="webp">WebP</option>
      </select>
    </div>
  </div>
  <div class="preview" id="preview" aria-live="polite"></div>
  <button id="start">Tải và đổi tên</button>
  <div class="progress" id="progress" hidden><progress id="bar" value="0" max="1"></progress></div>
  <p id="status" role="status"></p>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4: Replace `popup.js`:**

```js
import { sanitize, originalUrl, parseLinks } from './naming.js';
import { collectImages, collectPageImages } from './content.js';

const $ = (id) => document.getElementById(id);
const isFlow = (url) => /^https:\/\/(flow\.google\.com|labs\.google)\/.*project\//.test(url || '');
let tab = null;
let items = []; // [{ thumb, url }] in page order

function say(text, bad = false) {
  $('status').textContent = text;
  $('status').classList.toggle('bad', bad);
}

function show(s) {
  if (!s) return;
  const fail = s.failed ? `, ${s.failed} lỗi` : '';
  say(s.running ? `Đang tải ${s.done} / ${s.total}${fail}` : `Đã tải ${s.done - s.failed} / ${s.total} ảnh${fail}`, s.failed > 0);
  $('progress').hidden = false;
  $('bar').max = s.total;
  $('bar').value = s.done;
  $('start').disabled = s.running;
}

const baseName = () => sanitize($('base').value || $('base').placeholder);

// Live preview of the names the user will get (extension depends on each image).
function preview() {
  const base = baseName();
  $('preview').replaceChildren(
    ...[1, 2].flatMap((n) => [Object.assign(document.createElement('b'), { textContent: base }), `-00${n}, `]),
    Object.assign(document.createElement('span'), { textContent: '…' }),
  );
}

// Tiles show the number each checked image will get.
function refreshSelection() {
  const boxes = [...$('grid').querySelectorAll('input')];
  let n = 0;
  for (const b of boxes) b.closest('.tile').querySelector('.num').textContent = b.checked ? String(++n).padStart(3, '0') : '';
  $('count').textContent = `Đã chọn ${n} / ${boxes.length}`;
  $('toggle-all').textContent = n === boxes.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
}

function renderGrid() {
  $('grid').replaceChildren(...items.map(({ thumb }, i) => {
    const tile = document.createElement('label');
    tile.className = 'tile';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
    box.setAttribute('aria-label', `Ảnh ${i + 1}`);
    const img = Object.assign(document.createElement('img'), { src: thumb, loading: 'lazy', alt: '' });
    const num = Object.assign(document.createElement('span'), { className: 'num' });
    const dim = Object.assign(document.createElement('span'), { className: 'dim' });
    img.onload = () => (dim.textContent = `${img.naturalWidth}×${img.naturalHeight}`);
    tile.append(img, box, num, dim);
    return tile;
  }));
  $('toggle-all').hidden = !items.length;
  if (items.length) refreshSelection();
  else $('count').textContent = 'Không thấy ảnh nào. Cuộn trang để tải thêm ảnh, hoặc dùng tab Dán link.';
}

async function scan() {
  const id = Number(new URLSearchParams(location.search).get('tab')); // test hook: E2E opens popup.html as a tab
  [tab] = id ? [await chrome.tabs.get(id)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const flow = isFlow(tab?.url);
  if (flow) $('count').textContent = 'Đang cuộn dự án Flow để tìm toàn bộ ảnh…';
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: flow ? collectImages : collectPageImages });
    items = (result || []).map((src) => ({ thumb: src, url: flow ? originalUrl(src) : src }));
    renderGrid();
  } catch {
    $('count').textContent = 'Trang này không cho đọc ảnh. Dùng tab Dán link.';
  }
}

function selectTab(name) {
  for (const t of ['page', 'paste']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
}

$('tab-page').addEventListener('click', () => selectTab('page'));
$('tab-paste').addEventListener('click', () => selectTab('paste'));
$('grid').addEventListener('change', refreshSelection);
$('toggle-all').addEventListener('click', () => {
  const boxes = [...$('grid').querySelectorAll('input')];
  const all = boxes.every((b) => b.checked);
  for (const b of boxes) b.checked = !all;
  refreshSelection();
});
$('links').addEventListener('input', () => ($('link-count').textContent = `${parseLinks($('links').value).length} link hợp lệ`));
$('base').addEventListener('input', preview);
chrome.runtime.onMessage.addListener((msg) => msg.type === 'progress' && show(msg));
chrome.runtime.sendMessage({ type: 'status' }).then(show);

$('start').addEventListener('click', async () => {
  const pasting = $('tab-paste').getAttribute('aria-selected') === 'true';
  const boxes = $('grid').querySelectorAll('input');
  const urls = pasting ? parseLinks($('links').value) : items.filter((_, i) => boxes[i].checked).map((it) => it.url);
  if (!urls.length) return say(pasting ? 'Dán ít nhất một link ảnh.' : 'Chọn ít nhất một ảnh.', true);
  $('start').disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'start', base: baseName(), urls, tabId: tab?.id, format: $('format').value });
  if (res?.error) { say(res.error, true); $('start').disabled = false; }
});

preview();
scan();
```

- [ ] **Step 5: Run** `npm test && npm run test:e2e`. Expected: A–E all `ok`, then `E2E PASS`.

- [ ] **Step 6: Visual check.** Add `await pop.screenshot({ path: path.join(os.tmpdir(), 'popup-grid.png') });` after the grid loads in scenario D, look at it, then remove the line. Check: tiles in 3 columns, checked tiles outlined with numbers `001`, `002`, the unchecked one dimmed, footer row with name and format aligned.

- [ ] **Step 7: Commit** `feat: popup picker with grid, paste links and format select`.

---

### Task 5: Docs touch-up and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-any-site-image-picker-design.md` (append a "Deviations" list copied from this plan's header)

- [ ] **Step 1:** Append the deviations section to the spec.
- [ ] **Step 2: Run** `npm test && npm run test:e2e`. Expected: all pass.
- [ ] **Step 3: Commit** `docs: record plan deviations in spec`.
