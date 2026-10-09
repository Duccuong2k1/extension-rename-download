# Any-Site Image Picker — Design

Date: 2026-10-09
Extends: `2026-10-09-flow-bulk-rename-download-design.md`

## Goal

Turn the Flow-only extension into one that works on any web page: pick images from
the current page (or paste image links), optionally convert them to a chosen format,
and download them renamed in order as `<base>-001.<ext>` into `Downloads/<base>/`.

## Decisions (agreed with user)

- **Format** = real conversion. Options: Keep original (default), PNG, JPG, WebP.
- **Picking happens in the popup** (thumbnail grid with checkboxes). On-page overlay
  and a separate tab are out of scope for now.
- **Paste links** tab: links separated by any whitespace (spaces or newlines).
- Naming and folder rules stay as they are (`naming.js`).
- On Flow, keep current behavior: auto-scroll the virtual grid, use the `=d` original.

## Popup UI (~400px wide)

- Tabs: **Ảnh trên trang** | **Dán link**.
- Page tab: thumbnail grid, each tile has a checkbox and its natural size
  (`1376×768`); "Chọn tất cả / Bỏ chọn"; counter "Đã chọn 12 / 40". All selected by
  default. Order = page order.
- Paste tab: a textarea; counter of valid links found.
- Shared footer: base-name input + live name preview (existing), format select,
  "Tải và đổi tên" button, progress bar and status (existing).
- Restricted pages (`chrome://`, Web Store): page tab shows a message pointing to the
  paste tab; paste tab still works.

## Collecting images (`content.js`)

- `collectImages()` (Flow, unchanged) stays.
- New `collectPageImages()` (self-contained, injected via `executeScript`):
  - `<img>`: `currentSrc`, else largest `srcset` candidate, else `src`.
  - `<picture>` is covered by `img.currentSrc`.
  - CSS `background-image: url(...)` on visible elements.
  - Skip `data:` URLs under 1 KB, images with natural or rendered size < 50×50,
    and duplicates by URL.
  - Order: by document position (top, then left).
  - Returns `[{ src, w, h }]`.
- Popup picks: Flow project URL → `collectImages()` + `originalUrl`; otherwise
  `collectPageImages()`. No auto-scroll on non-Flow pages.

## Download + conversion (`background.js`)

Per image, in order:
1. **In-tab fetch** (current `fetchAsBlobUrl`, extended with a `format` argument):
   fetch with cookies; if `format` is not "keep", decode with `createImageBitmap`, draw
   to a canvas (white background for JPG), `convertToBlob` with the target type
   (JPG quality 0.92). Return a page-origin blob URL + mime. Download it.
2. **Fallback** when step 1 throws (CORS block, page cannot be scripted): an
   offscreen document (`chrome.offscreen`, reason `BLOBS`) does the same fetch and
   conversion from the extension origin, using `<all_urls>` host permission, and
   returns an extension-origin blob URL.
3. Extension of the saved file comes from the final mime (`extFromMime`).
4. Failures are counted and reported, as today.

Paste-link downloads use the same pipeline with the active tab (if scriptable)
for step 1, else go straight to step 2.

## Permissions

`downloads`, `scripting`, `activeTab`, `offscreen`; host `<all_urls>` (needed for the
fallback fetch and for injecting into any page). Chrome will show "read and change
all your data on all websites" on reload — expected.

## Pure helpers (`naming.js`) + tests

- `parseLinks(text)`: split on whitespace, keep `http(s):` and `data:image/` URLs,
  dedupe, keep order.
- `largestSrcset(srcset, base)`: pick the largest `w`/`x` candidate, resolved to an
  absolute URL.
- `mimeForFormat(format)`: `png|jpg|webp` → `image/png|image/jpeg|image/webp`.
- Unit tests in `naming.test.js`.

## Testing

- Unit tests for the helpers above.
- E2E (Playwright harness) extended: a generic mock page with `<img>`, `srcset`,
  a CSS background, a tiny icon (must be skipped), and a cross-origin image without
  CORS headers (must succeed through the fallback); convert to PNG and check the file
  signature; paste-link download of two URLs.
- Flow E2E keeps passing.

## Out of scope

Auto-scroll on non-Flow pages, size/type filters, video, on-page selection overlay,
separate picker tab, quality slider.

## Deviations

- `largestSrcset` and `mimeForFormat` do not go into `naming.js`: they are used only inside functions injected with `executeScript`, which must be self-contained. So they live inline in `collectPageImages` and `fetchImage`, and the E2E covers them.
- Collectors return plain URL strings. The popup reads each thumbnail's natural size when it loads, so there is no `{w, h}` plumbing.
- Conversion decodes with `new Image()` + `decode()` instead of `createImageBitmap`, because `createImageBitmap` cannot decode SVG.
- Size filter skips an image only when both its natural and rendered size are under 50×50 (`Math.max(natural, rendered)`), so small-file images displayed large still appear.
