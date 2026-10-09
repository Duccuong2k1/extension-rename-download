// Injected via chrome.scripting.executeScript({func}) — must stay self-contained.
// Flow's grid is a cdk virtual scroller, so tiles leave the DOM as you scroll:
// collect while scrolling, then order by on-screen position (row, then column).
export function collectImages() {
  // One scan per tab: a second call (popup reopened) shares the running one.
  return (window.__flowCollect ||= scrollCollect().finally(() => { window.__flowCollect = null; }));

  async function scrollCollect() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sc = document.querySelector('.cdk-virtual-scrollable');
  if (!sc) return [];
  const seen = new Map();
  const grab = () => {
    const top0 = sc.getBoundingClientRect().top;
    document.querySelectorAll('img.image').forEach((img) => {
      if (img.closest('.container')?.querySelector('video')) return; // video tile
      if (!img.src.startsWith('http')) return;
      const key = new URL(img.src).pathname.replace(/=[^=/]*$/, ''); // same image at any size
      if (seen.has(key)) return;
      const r = img.getBoundingClientRect();
      seen.set(key, { src: img.src, y: Math.round(r.top - top0 + sc.scrollTop), x: Math.round(r.left) });
    });
  };

  sc.scrollTop = 0;
  await sleep(800);
  let last = -1, stable = 0;
  // ponytail: stops after ~3 idle steps at the bottom; raise sleep if Flow loads slowly.
  for (let n = 0; n < 2000 && stable < 3; n++) {
    grab();
    sc.scrollTop += sc.clientHeight * 0.8;
    await sleep(500);
    if (sc.scrollTop === last) stable++;
    else { stable = 0; last = sc.scrollTop; }
  }
  grab();
  sc.scrollTop = 0;

  return [...seen.values()].sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.src);
  }
}

// Injected via executeScript — must stay self-contained. Returns absolute URLs in page order.
export function collectPageImages() {
  const found = new Map();
  const add = (url, el, w = 0, h = 0) => {
    let href;
    try { href = new URL(url, location.href).href; } catch { return; }
    if (!/^(https?:|data:image\/)/.test(href) || found.has(href)) return;
    if (href.startsWith('data:') && href.length < 1400) return; // inline icons / placeholders
    const r = el.getBoundingClientRect();
    if (Math.max(w, r.width) < 50 || Math.max(h, r.height) < 50) return;
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
