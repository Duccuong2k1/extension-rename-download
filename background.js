import { fileName, extFromMime } from './naming.js';

let status = null; // { done, failed, total, running }

// Runs inside the Flow tab: the image URLs need the user's Google login cookies,
// which chrome.downloads requests from the extension don't carry.
async function fetchAsBlobUrl(url) {
  const res = await fetch(url, { credentials: 'include' });
  const blob = await res.blob();
  if (!res.ok || !blob.type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${blob.type}`);
  const blobUrl = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60_000);
  return { blobUrl, mime: blob.type };
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

async function run(base, urls, tabId) {
  status = { done: 0, failed: 0, total: urls.length, running: true };
  report();
  for (const [i, url] of urls.entries()) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: fetchAsBlobUrl, args: [url] });
      if (!result) throw new Error('fetch failed in page');
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
    run(msg.base, msg.urls, msg.tabId);
    reply({ ok: true });
  }
});
