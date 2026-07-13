# Zo Co-browse — Human Verification Checklist

> Use this before every release, build, or QA pass.  
> Check off items as you verify them in a **loaded Chrome instance** with the extension installed in developer mode.

---

## 1. Installation & Load

- [ ] Extension loads without errors (chrome://extensions → no red banner)
- [ ] Side panel opens via toolbar icon click
- [ ] Side panel opens via keyboard shortcut (`Ctrl+Shift+Z` / `Cmd+Shift+Z`)
- [ ] No console errors in service worker (`chrome://extensions → Inspect views: background page`)
- [ ] No console errors in side panel (`right-click Inspect` in the panel)
- [ ] Options page loads at `chrome-extension://<id>/options.html`
- [ ] All icon sizes present: 16, 32, 48, 128, 256

---

## 2. Configuration

- [ ] Options page shows all fields: Access Token, API URL, Model, Persona IDs, Screenshot toggle, Context Menus toggle, Persona Routing mode
- [ ] Entering an access token and clicking "Test Connection" succeeds or fails gracefully (doesn't crash)
- [ ] Saving settings persists across panel close/reopen
- [ ] "Reset to defaults" clears stored config
- [ ] Persona routing mode cycles correctly: Auto → Lite → Full (verify badge in panel header)

---

## 3. Core Chat & Zo Interaction

- [ ] Type a question in the input → response appears in the conversation area
- [ ] Streaming response shows progressive text (not appearing all at once)
- [ ] Streaming can be cancelled mid-response (if cancel button exists)
- [ ] Actions returned by Zo render in the action timeline (ticket #03)
- [ ] Actions are clickable and execute in the browser tab
- [ ] "New chat" button clears the conversation
- [ ] Chat history shows most recent conversations
- [ ] Chat history persists across panel open/close

---

## 4. Persona Routing (Auto/Lite/Full)

**Auto Mode (default):**
- [ ] Simple queries (under 3 words, greetings) route to Lite persona
- [ ] Complex queries (multi-sentence, analysis requests) route to Full persona
- [ ] Bang commands route to appropriate personas
- [ ] Mode is displayed correctly in routing badge

**Lite Mode:**
- [ ] Responses are shorter and faster
- [ ] No browser actions (click, fill, navigate) are performed

**Full Mode:**
- [ ] Full Zo capability including browser actions
- [ ] Actions execute in the active tab

---

## 5. Right-Click Context Menu (Ticket #02)

- [ ] Right-click on page → "Ask Zo about this page" appears
- [ ] Right-click on selected text → "Ask Zo about this" appears
- [ ] Right-click on link → "Ask Zo about this link" appears
- [ ] Clicking any context menu item opens side panel with query pre-filled
- [ ] Context menu items can be toggled on/off in options page

---

## 6. Keyboard Shortcuts (Ticket #06)

- [ ] `Ctrl+Shift+Z` / `Cmd+Shift+Z` — Open/close side panel
- [ ] `Ctrl+Shift+Y` / `Cmd+Shift+Y` — Summarize current page
- [ ] `Ctrl+Shift+X` / `Cmd+Shift+X` — Extract content from page
- [ ] `Ctrl+Shift+Q` / `Cmd+Shift+Q` — Quick query (focus input)
- [ ] Shortcuts are visible in `chrome://extensions/shortcuts`

---

## 7. Bang Commands (Ticket #07)

Test each:

| Command | Test Case | Expected |
|---------|-----------|----------|
| `!summarize` | On any news article | Returns 3-5 bullet summary |
| `!extract` | On a table-heavy page | Returns structured data |
| `!research [topic]` | `!research UPI trends` | Returns research summary |
| `!qa [question]` | `!qa what is this page about` | Returns answer about page |
| `!ask [question]` | `!ask who made this site` | Returns answer (no page context) |
| `!fill` | On a form page | Shows fill instructions |
| `!skills` | Any page | Lists available skills |
| `!skill [name]` | `!skill summarize` | Runs the named skill |
| `!save [path]` | `!save test-note` | Saves page to workspace, returns path |
| `!auto [instruction]` | `!auto check this page daily` | Creates an automation |
| `!query [question]` | `!query show me debt data` | Runs DuckDB query |
| `!data [question]` | `!data transaction volumes` | Same as !query |
| `!help` / `!commands` | Any page | Lists all available commands |
| `!unknowncommand` | Any page | Shows error + suggests `!help` |

---

## 8. Screenshot & Vision Context (Ticket #01)

- [ ] Screenshot is captured and sent with queries (check network request body in DevTools)
- [ ] Screenshot toggle in options disables screenshot capture
- [ ] When screenshot is disabled, only DOM text context is sent
- [ ] Error handling: if screenshot fails (chrome:// page, etc.), falls back to text-only

---

## 9. DuckDB Queries (Ticket #05)

- [ ] `!query show tables` returns a result set or clear error message
- [ ] `!query SELECT * FROM table LIMIT 5` returns formatted table
- [ ] Error: `!query DROP TABLE` returns "write queries not allowed" error
- [ ] Results display in a scrollable table format

---

## 10. Skills Runner (Ticket #04)

- [ ] `!skills` returns a list of available skills
- [ ] `!skill summarize` runs the summarize skill and returns output
- [ ] Skill output appears inline in the conversation
- [ ] Unknown skill name returns helpful error message

---

## 11. Automations (Ticket #08)

- [ ] `!auto summarize this page daily at 9am` creates an automation
- [ ] Automation creation confirmation appears with details
- [ ] Automation appears in Zo Computer automations list

---

## 12. Save Page (Ticket #09)

- [ ] `!save` saves the current page to default workspace path
- [ ] `!save my-folder/my-note` saves to custom path
- [ ] Saved file appears in Zo workspace at the specified path
- [ ] Context menu "Save page to Zo" works

---

## 13. Omnibox (Ticket #13)

- [ ] Type `zo` in Chrome address bar → omnibox suggestion appears
- [ ] `zo summarize this page` → opens side panel with query
- [ ] `zo !query show tables` → opens side panel with bang command

---

## 14. Onboarding (Ticket #12)

- [ ] First-time user sees onboarding wizard
- [ ] Onboarding has 4 steps with clear instructions
- [ ] "Skip" dismisses onboarding and opens main panel
- [ ] Onboarding persists — closing and reopening resumes at the same step
- [ ] "Reset onboarding" in options page restarts the wizard

---

## 15. Presets

- [ ] Built-in presets show in dropdown with separator
- [ ] Custom preset can be created
- [ ] Custom preset can be deleted
- [ ] Built-in presets cannot be deleted (delete button hidden)
- [ ] Selecting a preset populates the prompt

---

## 16. Themes

- [ ] Theme switcher in options shows all available themes
- [ ] Selected theme applies to side panel immediately
- [ ] Theme persists across panel reopen
- [ ] Each theme is visually distinct and readable

---

## 17. Model & Persona Selectors

- [ ] Model dropdown populates from Zo API (`/api/models`)
- [ ] Persona dropdown populates from Zo API
- [ ] Selected model is used in queries
- [ ] Selected persona overrides automatic routing

---

## 18. History

- [ ] "History" button opens conversation list
- [ ] Conversations are grouped by date
- [ ] Clicking a conversation restores it
- [ ] History shows last 50 conversations
- [ ] "Back" button returns to current chat

---

## 19. Page Context Capture

- [ ] Page title is captured correctly
- [ ] Visible text is captured (not hidden/offscreen text)
- [ ] Form fields are identified (max 30)
- [ ] Clickable elements are identified (buttons, links)
- [ ] Chrome system pages (`chrome://`, `about:`) show graceful "can't access" message
- [ ] Error pages show graceful error message

---

## 20. Content Script — Action Execution

- [ ] `navigate` action opens a URL in the current tab
- [ ] `click` action clicks a button/link by CSS selector
- [ ] `fill` action types text into a form field
- [ ] `extract` action reads content from specified elements
- [ ] `scroll` action scrolls the page (up/down)
- [ ] `wait` action pauses for specified duration
- [ ] `done` action triggers completion and returns result
- [ ] Actions execute in sequence (timeline order)
- [ ] Each action shows its status (pending → running → done)
- [ ] Navigation confirmation prompt appears (if enabled)

---

## 21. Zo.space Integration

- [ ] Landing page at `https://cashlessconsumer.zo.space/co-browse` renders correctly
- [ ] `/api/cobrowse/query` returns DuckDB query results (with auth)
- [ ] `/api/cobrowse/research` returns research results (with auth)
- [ ] Unauthorized requests return 401

---

## 22. Edge Cases

- [ ] Empty/near-empty pages (blank page, 404, redirect loop)
- [ ] Very long pages (100K+ characters of text)
- [ ] Pages with JavaScript-heavy rendering (SPAs)
- [ ] Pages behind login (requires user to be logged in)
- [ ] Multiple tabs open simultaneously
- [ ] Extension disabled → re-enabled (settings preserved?)
- [ ] Network offline → clear "connection failed" message
- [ ] Invalid/expired access token → clear auth error
- [ ] Panel open while navigating to a new page
- [ ] Very rapid consecutive queries (rate limiting?)

---

## 23. Privacy & Security

- [ ] Only current tab content is sent to Zo (no background tabs)
- [ ] Access token stored only in `chrome.storage.sync`
- [ ] No data logged by extension beyond chat history (local storage)
- [ ] No third-party analytics or tracking calls
- [ ] Chat history can be cleared

---

## 24. Build & Package

- [ ] `bun test` passes all 83 tests
- [ ] `bun run package` creates `zo-cobrowse.zip`
- [ ] Zip loads correctly in Chrome via "Load unpacked"
- [ ] Zip size is reasonable (< 5MB)

---

## Known Issues (Not Blocking)

These are documented in the QA report at `file 'QA_REPORT.md'`:
- B1: `check-icons` npm script has parse errors (low — not in normal workflow)
- B2: `/api/cobrowse/query` uses `bun:sqlite` on DuckDB file (high — blocks DuckDB queries)
- B3: Screenshot uses PNG instead of JPEG (low — larger payload)
- B4: No SSE stream reconnection (medium — truncated responses on flaky connections)
- B5: No explicit CSP in manifest (low — MV3 default is restrictive)
- B6: API auth is optional (medium — security hardening for launch)

---

*Last updated: 2026-07-13*
