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

let proc;
(async () => {
  const cdn = await serve((req, res) => {
    if (req.url.endsWith('.bin')) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(PNG); }
    if (req.url.endsWith('.html')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>login</html>'); }
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
  proc = require('child_process').spawn(CHROME, [`--user-data-dir=${prof}`, '--remote-debugging-port=9333', '--no-first-run',
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
  const both = await ext.evaluate(async ({ tabId }) => {
    const { collectImages } = await import('./content.js');
    const run = () => chrome.scripting.executeScript({ target: { tabId }, func: collectImages });
    return (await Promise.all([run(), run()])).map(([r]) => r.result);
  }, { tabId: flowTab });
  assert.equal(both[0].length, FLOW_N);
  assert.deepEqual(both[0], both[1]);
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

  // C: page scan picks srcset's biggest, CSS background, cross-origin; skips the 16px icon.
  const scanned = await ext.evaluate(async ({ tabId }) => {
    const { collectPageImages } = await import('./content.js');
    return (await chrome.scripting.executeScript({ target: { tabId }, func: collectPageImages }))[0].result;
  }, { tabId: siteTab });
  assert.deepEqual(scanned, [SITE + '/big.jpg', SITE + '/bg.jpg', CDN + '/cross.png']);
  console.log('C page scan: ok');

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

  // F: octet-stream image is sniffed and saved as PNG; an HTML login page is rejected.
  await ext.evaluate(async ({ tabId, urls }) => {
    await chrome.runtime.sendMessage({ type: 'start', base: 'oct', urls, tabId, format: 'keep' });
  }, { tabId: siteTab, urls: [CDN + '/a.bin', CDN + '/b.html'] });
  await waitFiles('oct', 1);
  for (let t = 0; t < 60 && (await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'status' })))?.running; t++) await new Promise((r) => setTimeout(r, 500));
  const oct = files('oct').filter((f) => !f.endsWith('.crdownload'));
  assert.deepEqual(oct, ['oct-001.png']);
  assert.ok(isPng(fs.readFileSync(path.join(dl, 'oct', oct[0]))), 'oct-001.png is not a real PNG');
  console.log('F octet-stream sniff: ok');

  console.log('E2E PASS');
  proc.kill(); cdn.close(); site.close();
  process.exit(0);
})().catch((e) => { console.error('E2E FAIL', e); proc?.kill(); process.exit(1); });
