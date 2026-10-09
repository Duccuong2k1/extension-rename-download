import { fetchImage } from './fetch-image.js';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'offscreen-fetch') return;
  fetchImage(msg.url, msg.format).then(reply, (e) => reply({ error: e.message }));
  return true; // async reply
});
