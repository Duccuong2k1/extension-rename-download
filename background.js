import { fileName, extFromMime } from './naming.js';
import { fetchImage } from './fetch-image.js';

let status = null; // { done, failed, total, running, cancelled? }
let runId = 0; // bumped on cancel so a stalled run's late results are ignored
let currentDownload = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Fetch and convert images for download' });
}

// In the tab first (site cookies, e.g. Flow login); else from the extension origin (no CORS limits).
// Format conversion always runs in the offscreen document: once the user switches away, Chrome
// throttles the tab's renderer and encoding there gets 5-6x slower.
async function getImage(url, format, tabId) {
  if (tabId != null) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: fetchImage, args: [url, format, true] });
      if (result?.dataUrl) url = result.dataUrl;
      else if (result) return result;
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

// fallbacks[i]: the URL shown on the page, tried when the full-size original (urls[i]) fails.
async function run(base, urls, tabId, format, fallbacks = []) {
  const my = ++runId;
  status = { done: 0, failed: 0, total: urls.length, running: true };
  report();
  for (const [i, url] of urls.entries()) {
    try {
      let result;
      try {
        result = await getImage(url, format, tabId);
      } catch (e) {
        if (!fallbacks[i] || my !== runId) throw e;
        result = await getImage(fallbacks[i], format, tabId);
      }
      if (my !== runId) return;
      const name = fileName(base, i + 1, urls.length, extFromMime(result.mime));
      const id = (currentDownload = await chrome.downloads.download({ url: result.blobUrl, filename: `${base}/${name}`, conflictAction: 'uniquify' }));
      const ok = await waitDone(id);
      if (my !== runId) return;
      if (!ok) status.failed++;
    } catch (e) {
      if (my !== runId) return;
      console.warn('download failed', url, e);
      status.failed++;
    }
    status.done++;
    report();
  }
  status.running = false;
  await countDownloads(status.done - status.failed); // before report: the popup reads it on "done"
  report();
}

// Lifetime count of downloaded images; the popup's donation invite waits for a threshold.
async function countDownloads(n) {
  if (!n) return;
  try {
    const { donate = {} } = await chrome.storage.local.get('donate');
    await chrome.storage.local.set({ donate: { ...donate, total: (donate.total || 0) + n } });
  } catch {}
}

function cancel() {
  if (!status?.running) return;
  runId++;
  Object.assign(status, { running: false, cancelled: true });
  if (currentDownload != null) chrome.downloads.cancel(currentDownload).catch(() => {});
  report();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'status') reply(status);
  if (msg.type === 'cancel') { cancel(); reply({ ok: true }); }
  if (msg.type === 'start') {
    if (status?.running) return reply({ error: 'Đang tải, vui lòng đợi.' });
    run(msg.base, msg.urls, msg.tabId, msg.format || 'keep', msg.fallbacks);
    reply({ ok: true });
  }
});
