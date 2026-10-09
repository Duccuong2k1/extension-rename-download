import { fileName, extFromMime } from './naming.js';

const pending = new Map(); // url -> { folder, base, index, total }
let status = null; // { done, failed, total, running }

// Registering this listener makes every download wait for suggest(), so always call it.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const job = pending.get(item.url);
  if (!job) return suggest();
  pending.delete(item.url);
  suggest({
    filename: `${job.base}/${fileName(job.base, job.index, job.total, extFromMime(item.mime))}`,
    conflictAction: 'uniquify',
  });
});

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

async function run(base, urls) {
  status = { done: 0, failed: 0, total: urls.length, running: true };
  report();
  for (const [i, url] of urls.entries()) {
    pending.set(url, { base, index: i + 1, total: urls.length });
    try {
      const id = await chrome.downloads.download({ url });
      if (!(await waitDone(id))) status.failed++;
    } catch {
      pending.delete(url);
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
    run(msg.base, msg.urls);
    reply({ ok: true });
  }
});
