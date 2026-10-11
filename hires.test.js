// Run: node hires.test.js
import assert from 'node:assert/strict';
import { fullSizeUrl } from './hires.js';

// Shopee: thumbnail and resize suffixes on /file/<id>.
const SHOPEE = 'https://down-vn.img.susercontent.com/file/';
assert.equal(fullSizeUrl(SHOPEE + 'vn-11134216-7ra0g-m6zgx2ftdqhka8_tn'), SHOPEE + 'vn-11134216-7ra0g-m6zgx2ftdqhka8');
assert.equal(fullSizeUrl(SHOPEE + 'sg-11134258-8259d-mu0bqbf8a2o239@resize_w1594_nl.webp'), SHOPEE + 'sg-11134258-8259d-mu0bqbf8a2o239');
assert.equal(fullSizeUrl(SHOPEE + 'vn-11134216-7ra0g-m6zgx2ftdqhka8'), SHOPEE + 'vn-11134216-7ra0g-m6zgx2ftdqhka8');

// Lazada: <image>.jpg_WxHqQ.jpg[_.webp|_.avif] on slatic.net / lazcdn.com.
assert.equal(fullSizeUrl('https://vn-live-01.slatic.net/p/d89b3a0f19afd7ca880bf45138af6a53.jpg_200x200q80.jpg_.webp'), 'https://vn-live-01.slatic.net/p/d89b3a0f19afd7ca880bf45138af6a53.jpg');
assert.equal(fullSizeUrl('https://img.lazcdn.com/g/p/abc.png_720x720q80.png'), 'https://img.lazcdn.com/g/p/abc.png');
assert.equal(fullSizeUrl('https://img.lazcdn.com/g/p/abc.jpg_2200x2200q80.jpg_.avif'), 'https://img.lazcdn.com/g/p/abc.jpg');
assert.equal(fullSizeUrl('https://img.lazcdn.com/g/tps/imgextra/i1/O1CN01_!!6000-1-tps-200-200.gif'), 'https://img.lazcdn.com/g/tps/imgextra/i1/O1CN01_!!6000-1-tps-200-200.gif');

// Tiki: /cache/<size>/ prefix, plus a .webp added after the real extension.
const TIKI = 'https://salt.tikicdn.com/';
assert.equal(fullSizeUrl(TIKI + 'cache/280x280/ts/product/cb/a9/4c/48456b4f.jpg'), TIKI + 'ts/product/cb/a9/4c/48456b4f.jpg');
assert.equal(fullSizeUrl(TIKI + 'cache/w1200/ts/product/cb/a9/4c/48456b4f.jpg.webp'), TIKI + 'ts/product/cb/a9/4c/48456b4f.jpg');
assert.equal(fullSizeUrl(TIKI + 'cache/100x100/ts/category/00/5d/97/78713d34.png.webp'), TIKI + 'ts/category/00/5d/97/78713d34.png');

// Pinterest: /<width>x/ or /<w>x<h>/ → /originals/.
assert.equal(fullSizeUrl('https://i.pinimg.com/236x/00/08/0b/00080b03.jpg'), 'https://i.pinimg.com/originals/00/08/0b/00080b03.jpg');
assert.equal(fullSizeUrl('https://i.pinimg.com/60x60/00/08/0b/00080b03.jpg'), 'https://i.pinimg.com/originals/00/08/0b/00080b03.jpg');
assert.equal(fullSizeUrl('https://i.pinimg.com/originals/00/08/0b/00080b03.jpg'), 'https://i.pinimg.com/originals/00/08/0b/00080b03.jpg');

// Anything else is left alone, including junk and data URLs.
assert.equal(fullSizeUrl('https://example.com/a_tn'), 'https://example.com/a_tn');
assert.equal(fullSizeUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
assert.equal(fullSizeUrl('not a url'), 'not a url');

console.log('hires tests passed');
