// Injected via chrome.scripting.executeScript({func}) — must stay self-contained.
// Flow's grid is a cdk virtual scroller, so tiles leave the DOM as you scroll:
// collect while scrolling, then order by on-screen position (row, then column).
export async function collectImages() {
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
