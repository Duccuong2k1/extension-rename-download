import { sanitize, originalUrl } from './naming.js';
import { collectImages } from './content.js';

const $ = (id) => document.getElementById(id);
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

// Live preview of the names the user will get (extension depends on each image).
function preview() {
  const base = sanitize($('base').value || $('base').placeholder);
  $('preview').replaceChildren(
    ...[1, 2].flatMap((n) => [Object.assign(document.createElement('b'), { textContent: base }), `-00${n}, `]),
    Object.assign(document.createElement('span'), { textContent: '…' }),
  );
}
$('base').addEventListener('input', preview);
preview();

chrome.runtime.onMessage.addListener((msg) => msg.type === 'progress' && show(msg));
chrome.runtime.sendMessage({ type: 'status' }).then(show);

$('start').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https:\/\/(flow\.google\.com|labs\.google)\/.*project\//.test(tab?.url || '')) {
    return say('Mở một dự án Google Flow rồi bấm lại.', true);
  }
  $('start').disabled = true;
  say('Đang cuộn trang để tìm toàn bộ ảnh…');
  try {
    const [{ result: urls }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectImages });
    if (!urls?.length) {
      $('start').disabled = false;
      return say('Dự án này chưa có ảnh nào.', true);
    }
    const res = await chrome.runtime.sendMessage({ type: 'start', base: sanitize($('base').value || $('base').placeholder), urls: urls.map(originalUrl), tabId: tab.id });
    if (res?.error) say(res.error, true);
  } catch (e) {
    $('start').disabled = false;
    say('Không tải được: ' + e.message, true);
  }
});
