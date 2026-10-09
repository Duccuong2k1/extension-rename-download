import { fileName, extFromMime } from './naming.js';
import { fetchImage } from './fetch-image.js';

let status = null; // { done, failed, total, running }

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

function waitDone(id) {
  return new Promise((resolve) => {
    const onChanged = (d) => {
      if (d.id !== id || !d.state) return;
      if (d.state.current === 'complete' || d.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(d.state.current === 'complete');
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    // Covers a download that finished before the listener was attached.
    chrome.downloads.search({ id }).then(([d]) => {
      if (d && d.state !== 'in_progress') {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(d.state === 'complete');
      }
    });
  });
}

const report = () => chrome.runtime.sendMessage({ type: 'progress', ...status }).catch(() => {});

async function run(base, urls, tabId, format) {
  status = { done: 0, failed: 0, total: urls.length, running: true };
  report();
  for (const [i, url] of urls.entries()) {
    try {
      const result = await getImage(url, format, tabId);
      const name = fileName(base, i + 1, urls.length, extFromMime(result.mime));
      const id = await chrome.downloads.download({ url: result.blobUrl, filename: `${base}/${name}`, conflictAction: 'uniquify' });
      if (!(await waitDone(id))) status.failed++;
    } catch (e) {
      console.warn('download failed', url, e);
      status.failed++;
    }
    status.done++;
    report();
  }
  status.running = false;
  report();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'status') reply(status);
  if (msg.type === 'start') {
    if (status?.running) return reply({ error: 'Đang tải, vui lòng đợi.' });
    run(msg.base, msg.urls, msg.tabId, msg.format || 'keep');
    reply({ ok: true });
  }
});
