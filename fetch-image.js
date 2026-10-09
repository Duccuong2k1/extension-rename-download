// Self-contained: injected into pages via executeScript and imported by offscreen.js.
export async function fetchImage(url, format) {
  const res = await fetch(url, { credentials: 'include' });
  let blob = await res.blob();
  if (!res.ok || !blob.type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${blob.type || 'unknown'}`);
  const target = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format];
  if (target && target !== blob.type) {
    // ponytail: animated GIF/WebP keep only the first frame when converted.
    const src = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 1024; // SVG without intrinsic size
      c.height = img.naturalHeight || 1024;
      const g = c.getContext('2d');
      if (target === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('convert failed'))), target, 0.92));
    } finally {
      URL.revokeObjectURL(src);
    }
  }
  const blobUrl = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60_000);
  return { blobUrl, mime: blob.type };
}
