// Big shops serve resized thumbnails; their CDNs return the original when the size part is dropped.
// Unknown URLs come back unchanged. Callers keep the shown URL as a fallback: a rule can miss.
export function fullSizeUrl(src) {
  let u;
  try { u = new URL(src); } catch { return src; }
  if (!/^https?:$/.test(u.protocol)) return src;
  const host = u.hostname;
  const path = u.pathname;
  if (/(^|\.)susercontent\.com$/.test(host) && path.startsWith('/file/')) {
    u.pathname = path.replace(/(_tn|@resize_[^/]*)$/, ''); // Shopee
  } else if (/(^|\.)(slatic\.net|lazcdn\.com)$/.test(host)) {
    u.pathname = path.replace(/(\.(?:jpe?g|png|webp|gif))_\d+x\d+q\d+\.\w+(?:_\.\w+)?$/i, '$1'); // Lazada
  } else if (host === 'salt.tikicdn.com') {
    u.pathname = path.replace(/^\/cache\/[^/]+\//, '/').replace(/(\.(?:jpe?g|png|gif))\.webp$/i, '$1'); // Tiki
  } else if (host === 'i.pinimg.com') {
    u.pathname = path.replace(/^\/\d+x\d*\//, '/originals/'); // Pinterest
  }
  return u.href;
}
