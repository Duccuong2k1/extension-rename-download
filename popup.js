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
  const text = s.running ? `Đang tải ${s.done} / ${s.total}${fail}`
    : s.cancelled ? `Đã hủy: tải được ${s.done - s.failed} / ${s.total} ảnh${fail}`
    : `Đã tải ${s.done - s.failed} / ${s.total} ảnh${fail}`;
  say(text, s.failed > 0 || !!s.cancelled);
  $('progress').hidden = false;
  $('bar').max = s.total;
  $('bar').value = s.done;
  $('start').disabled = s.running;
  $('cancel').hidden = !s.running;
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

function makeTile({ thumb }, i) {
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
}

// Appends only unseen images, so ticks survive and images the page dropped from its DOM stay.
function addItems(fresh) {
  const seen = new Set(items.map((it) => it.url));
  const added = fresh.filter((it) => !seen.has(it.url) && seen.add(it.url));
  $('grid').append(...added.map((it, k) => makeTile(it, items.length + k)));
  items.push(...added);
  $('toggle-all').hidden = !items.length;
  $('sync').hidden = false;
  if (items.length) refreshSelection();
  else $('count').textContent = 'Không thấy ảnh nào. Cuộn trang để tải thêm ảnh, rồi bấm Cập nhật ảnh, hoặc dùng tab Dán link.';
  return added.length;
}

async function scan(sync = false) {
  if (!sync) {
    const id = Number(new URLSearchParams(location.search).get('tab')); // test hook: E2E opens popup.html as a tab
    [tab] = id ? [await chrome.tabs.get(id)] : await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!sync && (await chrome.runtime.sendMessage({ type: 'status' }))?.running) {
    $('count').textContent = 'Đang tải ảnh. Bấm Cập nhật ảnh sau khi tải xong để chọn ảnh mới.';
    $('sync').hidden = false;
    return;
  }
  const flow = isFlow(tab?.url);
  if (flow) $('count').textContent = 'Đang cuộn dự án Flow để tìm toàn bộ ảnh…';
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: flow ? collectImages : collectPageImages });
    const added = addItems((result || []).map((src) => ({ thumb: src, url: flow ? originalUrl(src) : src })));
    if (sync && items.length) $('count').textContent = `${added ? `Thêm ${added} ảnh mới` : 'Không có ảnh mới'}. ${$('count').textContent}`;
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
$('sync').addEventListener('click', async () => {
  $('sync').disabled = true;
  await scan(true);
  $('sync').disabled = false;
});
$('cancel').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
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
  try {
    const res = await chrome.runtime.sendMessage({ type: 'start', base: baseName(), urls, tabId: tab?.id, format: $('format').value });
    if (res?.error) { say(res.error, true); $('start').disabled = false; }
  } catch (e) {
    say('Không tải được: ' + e.message, true);
    $('start').disabled = false;
  }
});

preview();
scan();
