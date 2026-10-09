import { sanitize } from './naming.js';
import { collectImages } from './content.js';

const $ = (id) => document.getElementById(id);
const say = (text) => ($('status').textContent = text);

function show(s) {
  if (!s) return;
  const fail = s.failed ? `, lỗi ${s.failed}` : '';
  say(s.running ? `Đang tải ${s.done}/${s.total}${fail}` : `Xong: ${s.done - s.failed} ảnh đã tải${fail}.`);
  $('start').disabled = s.running;
}

chrome.runtime.onMessage.addListener((msg) => msg.type === 'progress' && show(msg));
chrome.runtime.sendMessage({ type: 'status' }).then(show);

$('start').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https:\/\/(flow\.google\.com|labs\.google)\/.*project\//.test(tab?.url || '')) {
    return say('Hãy mở một dự án Google Flow trước.');
  }
  $('start').disabled = true;
  say('Đang cuộn và quét ảnh…');
  try {
    const [{ result: urls }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectImages });
    if (!urls?.length) {
      $('start').disabled = false;
      return say('Không tìm thấy ảnh nào.');
    }
    const res = await chrome.runtime.sendMessage({ type: 'start', base: sanitize($('base').value), urls, tabId: tab.id });
    if (res?.error) say(res.error);
  } catch (e) {
    $('start').disabled = false;
    say('Lỗi: ' + e.message);
  }
});
