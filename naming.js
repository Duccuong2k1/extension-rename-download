// Characters Windows forbids in file names, plus control chars.
const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitize(base) {
  // Chrome rejects names with leading/trailing dots or spaces.
  const clean = String(base ?? '').replace(ILLEGAL, '').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  return clean || 'flow';
}

export function fileName(base, index, total, ext) {
  const width = Math.max(3, String(total).length);
  return `${base}-${String(index).padStart(width, '0')}.${ext}`;
}

// Swap the size suffix (=s1600-rw) in the path for =d (original file); keep ?authuser=N.
export function originalUrl(src) {
  const u = new URL(src);
  u.pathname = u.pathname.replace(/=[^=/]*$/, '') + '=d';
  return u.href;
}

export function extFromMime(mime) {
  const sub = (mime || '').split('/')[1]?.split(';')[0].trim();
  return { jpeg: 'jpg', 'svg+xml': 'svg' }[sub] || sub || 'jpg';
}

// Pasted links may be separated by any mix of spaces and newlines.
export function parseLinks(text) {
  return [...new Set(String(text ?? '').split(/\s+/).filter((s) => /^(https?:\/\/\S+|data:image\/)/i.test(s)))];
}
