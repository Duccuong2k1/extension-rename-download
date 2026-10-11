// Self-contained: injected into pages via executeScript and imported by offscreen.js.
// rawForConvert: hand back the bytes as a data URL instead of converting here (see getImage).
export async function fetchImage(url, format, rawForConvert = false) {
  const res = await fetch(url, { credentials: 'include' });
  let blob = await res.blob();
  if (res.ok && !blob.type.startsWith('image/')) {
    // CDNs/S3 often serve real images as octet-stream: trust magic bytes, not the header.
    const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const at = (sig, off = 0) => sig.every((v, i) => b[off + i] === v);
    const type = at([0x89, 0x50, 0x4e, 0x47]) ? 'image/png' : at([0xff, 0xd8, 0xff]) ? 'image/jpeg'
      : at([0x47, 0x49, 0x46, 0x38]) ? 'image/gif' : at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8) ? 'image/webp' : '';
    if (type) blob = new Blob([blob], { type });
  }
  if (!res.ok || !blob.type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${blob.type || 'unknown'}`);
  const target = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format];
  if (target && target !== blob.type && rawForConvert) {
    const dataUrl = await new Promise((ok, fail) => Object.assign(new FileReader(), { onload: (e) => ok(e.target.result), onerror: fail }).readAsDataURL(blob));
    return { dataUrl };
  }
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
