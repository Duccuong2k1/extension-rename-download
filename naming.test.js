// Run: node naming.test.js
import assert from 'node:assert/strict';
import { sanitize, fileName, extFromMime } from './naming.js';

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

console.log('naming tests passed');
