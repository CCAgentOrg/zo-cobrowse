// Modes — pure logic, no chrome.* or DOM dependencies.
// A Mode is the single source of truth for how Zo behaves on a request:
// which system prompt/instructions it gets, how much page context, and
// whether it should respond with actions (JSON) or plain markdown.
// Imported by background.js + sidepanel.js (ESM) and directly by tests.

/**
 * Compact action protocol — shipped only when a Mode sets expectJson:true.
 * One line vs the old ~130-token commented JSON block.
 */
export const ACTION_SCHEMA_COMPACT =
  'Respond with JSON {"reasoning":"...","actions":[...]}. ' +
  'Actions: click{selector} | fill{selector,value} | extract{selector,attribute} | ' +
  'navigate{url} | scroll{direction,amount?} | wait{ms} | done{response}.';

/**
 * Fallback instructions for Modes that don't define their own.
 */
export const PLAIN_RESPONSE_HINT = 'Respond in plain markdown.';

/**
 * Context tiers — how much of the page is sent to Zo.
 *   0 = pointer   — URL + title + viewport only
 *   1 = +text     — add visibleText sliced to textBudget
 *   2 = +elements — add compact clickable + form-field list (with selectors)
 *   3 = +screenshot — add a screenshot
 */
export const TIER = Object.freeze({ POINTER: 0, TEXT: 1, ELEMENTS: 2, SCREENSHOT: 3 });

/**
 * Built-in Modes. Each is immutable (builtin:true). Custom Modes (from the ✦
 * generator or migrated from legacy presets) live in storage and merge over
 * these via resolveMode().
 */
export const BUILTIN_MODES = {
  cobrowse: {
    id: 'cobrowse',
    name: 'Co-browse',
    icon: '🤖',
    systemPrompt: "You are Zo — the user's AI co-browsing assistant. You see the page they're on and can control the browser.",
    instructions: 'Act on the page to fulfill the request. Use the ELEMENTS list when targeting clicks/fills.',
    contextTier: TIER.ELEMENTS,
    textBudget: 4000,
    expectJson: true,
    builtin: true,
  },
  ask: {
    id: 'ask',
    name: 'Ask',
    icon: '💬',
    systemPrompt: "You are Zo — the user's browser companion. You see the page they're on. Keep responses concise and scannable.",
    instructions: 'Answer the user\'s question using the page content provided.',
    contextTier: TIER.TEXT,
    textBudget: 2000,
    expectJson: false,
    builtin: true,
  },
  research: {
    id: 'research',
    name: 'Research',
    icon: '🔬',
    systemPrompt: "You are Zo — the user's AI research assistant. Deeply analyze the current page: extract key facts, data, sources, insights. Cite specific content.",
    instructions: 'Extract key claims, data, named entities, sources, dates, and contradictions. Organize with clear headings.',
    contextTier: TIER.TEXT,
    textBudget: 4000,
    expectJson: true,
    builtin: true,
  },
  summarize: {
    id: 'summarize',
    name: 'Summarize',
    icon: '📝',
    systemPrompt: "You are Zo — the user's summarization assistant. Condense the page into its essential points. Concise, objective, organized.",
    instructions: 'Produce a concise summary: 3-5 bullets or a short paragraph. Cover the main argument, key evidence, and conclusion.',
    contextTier: TIER.TEXT,
    textBudget: 2000,
    expectJson: true,
    builtin: true,
  },
  extract: {
    id: 'extract',
    name: 'Extract',
    icon: '📥',
    systemPrompt: "You are Zo — the user's data extraction assistant. Extract structured data from the page into clean tables or JSON.",
    instructions: 'Extract all structured data: tables, lists, contacts, prices, dates, links. Be exhaustive.',
    contextTier: TIER.ELEMENTS,
    textBudget: 4000,
    expectJson: true,
    builtin: true,
  },
  visual: {
    id: 'visual',
    name: 'Visual',
    icon: '🖼️',
    systemPrompt: "You are Zo — answering questions about what is visible on the user's screen, using the screenshot provided.",
    instructions: 'Describe or analyze what is visible in the screenshot.',
    contextTier: TIER.SCREENSHOT,
    textBudget: 1000,
    expectJson: false,
    builtin: true,
  },
};

export const DEFAULT_MODE_ID = 'cobrowse';

/**
 * Resolve a Mode id to a Mode object.
 * Custom modes override built-ins by id; unknown/missing ids fall back to
 * the default Mode so callers never receive null.
 *
 * @param {string} modeId
 * @param {Record<string, object>} [customModes={}]
 * @returns {object} a full Mode object
 */
export function resolveMode(modeId, customModes = {}) {
  if (modeId && customModes[modeId]) return normalizeMode(customModes[modeId], modeId);
  if (modeId && BUILTIN_MODES[modeId]) return BUILTIN_MODES[modeId];
  return BUILTIN_MODES[DEFAULT_MODE_ID];
}

/**
 * Migrate a legacy preset object to a full Mode, backfilling the fields a
 * preset never carried (contextTier, textBudget, expectJson). Used by the
 * one-time storage migration in sidepanel.js and by generateMode().
 */
export function presetToMode(preset) {
  const id = preset.id || ('custom_' + Date.now());
  return {
    id,
    name: preset.name || 'Custom mode',
    icon: preset.icon || '✨',
    description: preset.description || '',
    systemPrompt: preset.systemPrompt || '',
    instructions: preset.instructions || '',
    contextTier: Number.isInteger(preset.contextTier) ? preset.contextTier : TIER.TEXT,
    textBudget: preset.textBudget || 2000,
    expectJson: preset.expectJson !== undefined ? !!preset.expectJson : true,
    builtin: false,
  };
}

/**
 * The set of action type names, mirrored from the action protocol.
 * Used to detect the "key-first" action shape Zo sometimes emits.
 * (Kept here — next to ACTION_SCHEMA_COMPACT, the single source of truth —
 * rather than duplicated in background.js.)
 */
export const ACTION_TYPE_NAMES = ['click', 'fill', 'extract', 'navigate', 'scroll', 'wait', 'done'];

/**
 * Normalize Zo's action payload to the canonical "type-first" form the
 * extension executes:
 *
 *   type-first (canonical):   { type: 'extract', selector: 'body', attribute: 'textContent' }
 *   key-first (Zo variant):   { extract: { selector: 'body', attribute: 'textContent' } }
 *
 * The compact schema shipped in the prompt (`extract{selector,attribute}`)
 * is ambiguous, and some models emit actions as `{"<type>": {...}}` instead
 * of `{"type": "<type>", ...}`. Without normalization those actions silently
 * drop out of every consumer (`a.type === 'done'`, executeActions, the
 * timeline) and the whole `{reasoning, actions}` blob leaks into the chat as
 * raw JSON. This converts key-first to type-first; already-canonical actions
 * pass through unchanged. Non-conforming entries are dropped.
 *
 * Pure (no chrome.* / DOM deps) so it's unit-testable directly.
 *
 * @param {unknown} actions
 * @returns {object[]} canonical type-first action objects
 */
export function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    if (typeof a.type === 'string' && ACTION_TYPE_NAMES.includes(a.type)) {
      // Already canonical. Keep as-is (the consumers own validation).
      out.push(a);
      continue;
    }
    // Key-first: a single key that is a known action type, mapped to its args.
    let found = false;
    for (const key of Object.keys(a)) {
      if (ACTION_TYPE_NAMES.includes(key)) {
        const args = (a[key] && typeof a[key] === 'object' && !Array.isArray(a[key])) ? a[key] : {};
        out.push({ type: key, ...args });
        found = true;
        break; // only the first recognized key wins
      }
    }
    if (!found) {
      // Unknown shape — skip rather than risk rendering raw JSON in the chat.
    }
  }
  return out;
}

/**
 * Ensure a (possibly user-supplied) mode object has every required field.
 * Missing fields fall back to safe defaults; an absent id uses the provided key.
 */
function normalizeMode(raw, key) {
  const m = raw || {};
  return {
    id: m.id || key,
    name: m.name || 'Custom mode',
    icon: m.icon || '✨',
    description: m.description || '',
    systemPrompt: m.systemPrompt || '',
    instructions: m.instructions || '',
    contextTier: Number.isInteger(m.contextTier) ? m.contextTier : TIER.TEXT,
    textBudget: m.textBudget || 2000,
    expectJson: m.expectJson !== undefined ? !!m.expectJson : true,
    builtin: false,
  };
}
