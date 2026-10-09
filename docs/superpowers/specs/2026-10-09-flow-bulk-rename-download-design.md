# Flow Bulk Rename & Download — Design

Date: 2026-10-09

## Goal

A personal Chrome extension (loaded unpacked) that downloads every image in an open
Google Flow project, renamed sequentially from a user-entered base name, in the order
Flow currently displays them.

## Decisions (agreed with user)

- Rename applies only to **downloaded files**; nothing changes inside Flow.
- Sort order (oldest / newest / most popular) is chosen **in Flow's own UI**; the
  extension numbers images in the on-screen order.
- **All images** in the project; videos are skipped.
- Filename: `<base>-001.<ext>`, `<base>-002.<ext>`… saved to `Downloads/<base>/`.
  Padding is 3 digits, growing to 4+ if count exceeds 999.
- Approach: **read image URLs from the page DOM** (approach 1). If the DOM only exposes
  thumbnails and no full-resolution URL can be derived, fall back to clicking Flow's
  own Download button per item (approach 2) — decided during implementation after
  inspecting the live page.

## Architecture (Manifest V3, plain JS, no build, no dependencies)

| File | Responsibility |
|------|----------------|
| `manifest.json` | MV3; permissions `downloads`, `activeTab`, `scripting`; host `https://labs.google/*` |
| `popup.html` / `popup.js` | Base-name input, Start button, progress text (`12/48`), final summary |
| `content.js` | Injected into the Flow tab: auto-scroll until no new images appear, collect image URLs in DOM order, skip videos and duplicates, return the list |
| `background.js` | Receives URL list + base name, downloads sequentially via `chrome.downloads.download({url, filename})`, reports progress, counts failures |
| `naming.js` | Pure functions: `sanitize(base)` (strip `\/:*?"<>|`, trim, fallback `flow`), `fileName(base, index, total, ext)` |

## Data flow

1. User picks sort in Flow, opens popup, enters base name, presses Start.
2. Popup injects `content.js` into the active tab (`chrome.scripting.executeScript`).
3. Content script scrolls to the end, returns ordered `[{url}]`.
4. Popup sends list to background; background downloads one by one; extension of each
   file taken from the response MIME type / URL (default `png`).
5. Progress messages update the popup; at the end: "Done: N downloaded, M failed".

## Error handling

- Active tab is not a Flow project → popup shows a message, nothing runs.
- Zero images found → message, nothing runs.
- A single download fails → skip, count it, continue.
- Empty / invalid base name → sanitized; empty falls back to `flow`.

## Testing

- `naming.test.js` (Node, assert-based, no framework): padding, >999 growth,
  sanitization of illegal characters, empty-name fallback.
- Manual run on a real Flow project: order matches screen, file names correct,
  images are full resolution, videos skipped.

## Out of scope

Renaming inside Flow, video download, per-image selection, settings page,
Chrome Web Store publishing.
