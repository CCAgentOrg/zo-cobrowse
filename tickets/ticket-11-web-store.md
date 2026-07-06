# Chrome Web Store Listing

**Phase**: P5 (Platform & Distribution)
**Priority**: 🔴 High
**Effort**: Small
**Labels**: `phase-5`, `priority-high`

## Description

The extension requires manual "Load unpacked" installation in developer mode. For real adoption, it needs to be listed on the Chrome Web Store. This involves preparing store assets, a privacy policy, and navigating the review process.

## Acceptance Criteria

- [ ] Extension package is prepared: `bun run package` produces a clean `zo-cobrowse.zip`
- [ ] Store listing title, description, and screenshots created
- [ ] Privacy policy written and hosted (zo.space page or GitHub Pages)
- [ ] 1280x800px screenshots showing: side panel + page context, Zo response with actions, settings page
- [ ] Small promotional tile (440x280px) and marquee screenshot created
- [ ] Extension submitted to Chrome Web Store for review
- [ ] Review feedback addressed (if any)
- [ ] Once published: extension can be installed with one click from the store

## Technical Notes

- Chrome Web Store developer registration costs a one-time $5 fee
- Privacy policy page can live on zo.space or GitHub Pages
- Screenshots should show real usage: a webpage + Zo responding with actions
- The store description should emphasize "Zoverignty" (Zo as backend) as the differentiator
- For the privacy policy: the extension sends page content and URL to the user's Zo instance (self-hosted or cloud) — no third-party data sharing
- Consider adding a small "rate" prompt after the first successful action

## Files to Edit

- `package.json` → `bun run package` script (already exists: `cd extension && zip`)
- Create `STORE_ASSETS.md` → screenshot specs and descriptions
- Create `PRIVACY.md` → privacy policy text for store
