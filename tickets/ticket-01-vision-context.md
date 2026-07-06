# Screenshot & Vision Context

**Phase**: P2 (Everywhere, Layered)
**Priority**: 🔴 High
**Effort**: Medium
**Labels**: `phase-2`, `priority-high`

## Description

Every competitor (Parchi, OpenDia, Comet, Gemini Chrome) supports sending page screenshots to the AI for visual understanding. Zo Co-browse is the only extension without this. The AI cannot see page layout, images, CSS state, or visual content — it relies entirely on DOM text.

## Acceptance Criteria

- [ ] `content.js`: Add `captureScreenshot()` function that captures page as base64 image using `dom-to-image` or native `html2canvas` equivalent
- [ ] `CAPTURE_CONTEXT` response includes `screenshot` field (base64, JPEG at 0.7 quality, max 1920px wide)
- [ ] Background service worker includes screenshot in context sent to `/zo/ask`
- [ ] Prompt instructs Zo to use the screenshot for visual understanding (layout, images, UI state)
- [ ] The user can optionally disable screenshot capture (privacy toggle in options page)
- [ ] Captured tab screenshot falls back to `chrome.tabs.captureVisibleTab` if content script unavailable
- [ ] Tests: verify screenshot field is present and is a valid base64 string

## Technical Notes

- `chrome.tabs.captureVisibleTab` requires `"permissions": ["activeTab", "tabs"]` (already present)
- JPEG at 0.7 quality gives ~5× smaller payload than PNG with acceptable quality
- For MV3 service worker: `captureVisibleTab` works from background, not content script
- Consider adding a config option to disable screenshots for privacy-sensitive pages
- Target: extend `getActiveTabContext()` in `extension/background.js` and `captureContext()` in `extension/content.js`

## Files to Edit

- `extension/background.js` → `getActiveTabContext()`, `askZo()`
- `extension/content.js` → `captureContext()`
- `extension/options.html` + `extension/options.js` → screenshot toggle
- `extension/manifest.json` → add permission if needed
