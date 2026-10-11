import { sanitize, originalUrl, parseLinks } from './naming.js';
import { fullSizeUrl } from './hires.js';
import { collectImages, collectPageImages, makeThumbs, headTypes } from './content.js';

const $ = (id) => document.getElementById(id);
const isFlow = (url) => /^https:\/\/(flow\.google\.com|labs\.google)\/.*project\//.test(url || '');
let tab = null;
let flow = false;
let items = []; // [{ src, full, w?, h?, type?, tile }] in page order; src = URL shown on the page
const offTypes = new Set(); // format labels the user filtered out
let syncNote = ''; // result of the last sync, kept in front of the count as tiles load

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

// Flow always needs its =d original; elsewhere the user can opt out of full-size rules.
const downloadUrl = (it) => (flow || $('hires').checked ? it.full : it.src);

// Remembered between popup openings.
async function loadPrefs() {
  let prefs = {};
  try { ({ prefs = {} } = await chrome.storage.local.get('prefs')); } catch {}
  if (prefs.base != null) $('base').value = prefs.base;
  if (prefs.format) $('format').value = prefs.format;
  if (prefs.minSize) $('min-size').value = prefs.minSize;
  if (prefs.hires != null) $('hires').checked = prefs.hires;
  for (const t of prefs.offTypes || []) offTypes.add(t);
  if (prefs.tab) selectTab(prefs.tab);
}

function savePrefs() {
  const tabName = $('tab-paste').getAttribute('aria-selected') === 'true' ? 'paste' : 'page';
  chrome.storage.local.set({ prefs: {
    base: $('base').value, format: $('format').value, minSize: $('min-size').value,
    hires: $('hires').checked, offTypes: [...offTypes], tab: tabName,
  } }).catch(() => {});
}

// Live preview of the names the user will get (extension depends on each image).
function preview() {
  const base = baseName();
  $('preview').replaceChildren(
    ...[1, 2].flatMap((n) => [Object.assign(document.createElement('b'), { textContent: base }), `-00${n}, `]),
    Object.assign(document.createElement('span'), { textContent: '…' }),
  );
}

const visible = () => items.filter((it) => !it.tile.hidden);

// Tiles show the number each checked, visible image will get.
function refreshSelection() {
  const shown = visible();
  let n = 0;
  for (const it of items) {
    const box = it.tile.querySelector('input');
    it.tile.querySelector('.num').textContent = !it.tile.hidden && box.checked ? String(++n).padStart(3, '0') : '';
  }
  const hiddenCount = items.length - shown.length;
  $('count').textContent = `${syncNote}Đã chọn ${n} / ${shown.length}${hiddenCount ? ` (ẩn ${hiddenCount})` : ''}`;
  $('toggle-all').textContent = n === shown.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
}

const TYPE_LABEL = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/avif': 'AVIF', 'image/svg+xml': 'SVG' };
const typeLabel = (type) => type && (TYPE_LABEL[type] || type.slice(6).toUpperCase());

// Hides images below the size or of a format the user switched off. Unknown size/type stays visible.
function applyFilters() {
  const min = Number($('min-size').value);
  for (const it of items) {
    const small = it.w != null && (it.w < min || it.h < min);
    it.tile.hidden = small || offTypes.has(typeLabel(it.type));
  }
  refreshSelection();
}

function renderDim(it) {
  if (it.w == null) return;
  const upgraded = !flow && $('hires').checked && it.full !== it.src;
  it.tile.querySelector('.dim').textContent = `${it.w}×${it.h}${upgraded ? ' → gốc' : ''}`;
}

function makeTile(it, i) {
  const tile = document.createElement('label');
  tile.className = 'tile';
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
  box.setAttribute('aria-label', `Ảnh ${i + 1}`);
  const img = Object.assign(document.createElement('img'), { loading: 'lazy', alt: '' });
  if (!flow) img.src = it.src; // Flow tiles get theirs later from loadThumbs
  const num = Object.assign(document.createElement('span'), { className: 'num' });
  const dim = Object.assign(document.createElement('span'), { className: 'dim' });
  img.onload = () => {
    if (flow) return;
    Object.assign(it, { w: img.naturalWidth, h: img.naturalHeight });
    renderDim(it);
    applyFilters();
  };
  tile.append(img, box, num, dim);
  return tile;
}

// Appends only unseen images, so ticks survive and images the page dropped from its DOM stay.
function addItems(fresh) {
  const seen = new Set(items.map((it) => it.full));
  const added = fresh.filter((it) => !seen.has(it.full) && seen.add(it.full));
  $('grid').append(...added.map((it, k) => (it.tile = makeTile(it, items.length + k))));
  items.push(...added);
  $('toggle-all').hidden = !items.length;
  $('filters').hidden = !items.length;
  $('sync').hidden = false;
  if (items.length) applyFilters();
  else $('count').textContent = 'Không thấy ảnh nào. Cuộn trang để tải thêm ảnh, rồi bấm Cập nhật ảnh, hoặc dùng tab Dán link.';
  return added;
}

// Flow images need the tab's login cookies, so the tab builds the thumbnails, a few at a time.
async function loadThumbs(added) {
  for (let i = 0; i < added.length; i += 12) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: makeThumbs, args: [added.slice(i, i + 12).map((it) => it.src)] });
    (result || []).forEach((t, k) => {
      if (!t) return;
      const it = added[i + k];
      it.tile.querySelector('img').src = t.src;
      Object.assign(it, { w: t.w, h: t.h });
      renderDim(it);
    });
    applyFilters();
  }
}

// Format chips plus a hint, from the formats the page really serves (URLs often lack an extension).
function renderTypes() {
  const counts = {};
  for (const { type } of items) {
    const label = typeLabel(type);
    if (label) counts[label] = (counts[label] || 0) + 1;
  }
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  $('type-filter').replaceChildren(...parts.map(([label]) => {
    const chip = Object.assign(document.createElement('button'), { className: 'chip', textContent: label });
    chip.setAttribute('aria-pressed', String(!offTypes.has(label)));
    chip.addEventListener('click', () => {
      offTypes.has(label) ? offTypes.delete(label) : offTypes.add(label);
      chip.setAttribute('aria-pressed', String(!offTypes.has(label)));
      savePrefs();
      applyFilters();
    });
    return chip;
  }));
  if (!parts.length) return ($('format-hint').textContent = '');
  const top = parts[0][0];
  const pick = ['JPG', 'PNG', 'WebP'].includes(top) ? top : 'JPG'; // only formats the select offers
  $('format-hint').textContent = `Ảnh trên trang: ${parts.map(([k, n]) => `${k} ${n}`).join(' · ')}. `
    + (parts.length === 1 ? `Chọn Giữ nguyên để ra ${top}, tải nhanh nhất.` : `Muốn cùng một định dạng thì chọn ${pick}; Giữ nguyên vẫn nhanh nhất.`);
}

// Types of the URLs that will actually be downloaded.
async function detectTypes(list) {
  const urls = list.map(downloadUrl);
  const types = [];
  for (let i = 0; i < urls.length; i += 24) {
    const chunk = urls.slice(i, i + 24);
    types.push(...(flow ? (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: headTypes, args: [chunk] }))[0].result : await headTypes(chunk)));
  }
  list.forEach((it, k) => (it.type = types[k]));
  renderTypes();
  applyFilters();
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
  flow = isFlow(tab?.url);
  $('hires').closest('label').hidden = flow;
  if (flow) $('count').textContent = 'Đang cuộn dự án Flow để tìm toàn bộ ảnh…';
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: flow ? collectImages : collectPageImages });
    const added = addItems((result || []).map((src) => ({ src, full: flow ? originalUrl(src) : fullSizeUrl(src) })));
    if (sync && items.length) {
      syncNote = `${added.length ? `Thêm ${added.length} ảnh mới` : 'Không có ảnh mới'}. `;
      refreshSelection();
    }
    if (flow) loadThumbs(added).catch(() => {});
    if (added.length) detectTypes(added).catch(() => {});
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

$('tab-page').addEventListener('click', () => { selectTab('page'); savePrefs(); });
$('tab-paste').addEventListener('click', () => { selectTab('paste'); savePrefs(); });

// Shift-click sets every visible tile between the last clicked one and this one to this one's state.
// The label's click carries shiftKey; the checkbox change that follows does not.
let anchor = null;
let shift = false;
$('grid').addEventListener('click', (e) => (shift = e.shiftKey), true);
$('grid').addEventListener('change', (e) => {
  const tile = e.target.closest('.tile');
  const tiles = visible().map((it) => it.tile);
  if (shift && tiles.includes(anchor)) {
    const [a, b] = [tiles.indexOf(anchor), tiles.indexOf(tile)].sort((x, y) => x - y);
    for (const t of tiles.slice(a, b + 1)) t.querySelector('input').checked = e.target.checked;
  }
  anchor = tile;
  refreshSelection();
});
$('toggle-all').addEventListener('click', () => {
  const boxes = visible().map((it) => it.tile.querySelector('input'));
  const all = boxes.every((b) => b.checked);
  for (const b of boxes) b.checked = !all;
  refreshSelection();
});
$('min-size').addEventListener('change', () => { savePrefs(); applyFilters(); });
$('hires').addEventListener('change', () => {
  savePrefs();
  items.forEach(renderDim);
  if (items.length) detectTypes(items).catch(() => {});
});
$('sync').addEventListener('click', async () => {
  $('sync').disabled = true;
  await scan(true);
  $('sync').disabled = false;
});
$('cancel').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
$('links').addEventListener('input', () => ($('link-count').textContent = `${parseLinks($('links').value).length} link hợp lệ`));
$('base').addEventListener('input', () => { preview(); savePrefs(); });
$('format').addEventListener('change', savePrefs);
chrome.runtime.onMessage.addListener((msg) => msg.type === 'progress' && show(msg));
chrome.runtime.sendMessage({ type: 'status' }).then(show);

$('start').addEventListener('click', async () => {
  const pasting = $('tab-paste').getAttribute('aria-selected') === 'true';
  const picked = pasting ? [] : visible().filter((it) => it.tile.querySelector('input').checked);
  const urls = pasting ? parseLinks($('links').value) : picked.map(downloadUrl);
  // If a full-size original fails, the background retries with the URL shown on the page.
  const fallbacks = picked.map((it) => (downloadUrl(it) !== it.src && !flow ? it.src : null));
  if (!urls.length) return say(pasting ? 'Dán ít nhất một link ảnh.' : 'Chọn ít nhất một ảnh.', true);
  $('start').disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'start', base: baseName(), urls, fallbacks, tabId: tab?.id, format: $('format').value });
    if (res?.error) { say(res.error, true); $('start').disabled = false; }
  } catch (e) {
    say('Không tải được: ' + e.message, true);
    $('start').disabled = false;
  }
});

await loadPrefs();
preview();
scan();
