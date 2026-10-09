// Run: node naming.test.js
import assert from 'node:assert/strict';
import { sanitize, fileName, extFromMime, originalUrl, parseLinks } from './naming.js';

assert.equal(sanitize('san pham'), 'san pham');
assert.equal(sanitize('a\\b/c:d*e?f"g<h>i|j'), 'abcdefghij');
assert.equal(sanitize('  ..ten.  '), 'ten');
assert.equal(sanitize(''), 'flow');
assert.equal(sanitize('???'), 'flow');
assert.equal(sanitize(undefined), 'flow');

assert.equal(fileName('sp', 1, 20, 'jpg'), 'sp-001.jpg');
assert.equal(fileName('sp', 999, 999, 'png'), 'sp-999.png');
assert.equal(fileName('sp', 7, 1200, 'png'), 'sp-0007.png');

assert.equal(extFromMime('image/jpeg'), 'jpg');
assert.equal(extFromMime('image/png'), 'png');
assert.equal(extFromMime('image/webp; charset=x'), 'webp');
assert.equal(extFromMime(''), 'jpg');

// Size suffix lives in the path; ?authuser=N must survive untouched.
assert.equal(originalUrl('https://flow.google.com/asb/ABC=s1600-rw'), 'https://flow.google.com/asb/ABC=d');
assert.equal(originalUrl('https://flow.google.com/asb/ABC=s1600-rw?authuser=0'), 'https://flow.google.com/asb/ABC=d?authuser=0');
assert.equal(originalUrl('https://flow.google.com/asb/ABC?authuser=1'), 'https://flow.google.com/asb/ABC=d?authuser=1');

assert.deepEqual(parseLinks('https://a.com/1.png https://b.com/2.jpg'), ['https://a.com/1.png', 'https://b.com/2.jpg']);
assert.deepEqual(parseLinks('  https://a.com/1.png\n\n\thttps://a.com/1.png\r\nhttp://c.com/x  '), ['https://a.com/1.png', 'http://c.com/x']);
assert.deepEqual(parseLinks('rác ftp://x.com/a.png javascript:alert(1) data:image/png;base64,AAAA'), ['data:image/png;base64,AAAA']);
assert.deepEqual(parseLinks(''), []);

console.log('naming tests passed');
