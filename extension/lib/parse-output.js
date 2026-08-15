// Zo output parsing — pure logic, no chrome.* or DOM dependencies.
// Extracted from background.js so the stream replay harness can import it
// directly (no VM slice) and so the read_tab loop can inspect a response's
// actions before the stream finishes. parseZoOutput is the parse half of the
// old finishStream; finishStream (background.js) stays the render half.

import { normalizeActions } from './modes.js';
import { safeText } from './prompt.js';

/**
 * Unwrap exactly one whole ``` fence around a string (cobrowse wraps its
 * action envelope in a ```json fence — see qa-notes.md). Non-fenced input is
 * returned untouched.
 */
export function stripCodeFence(str) {
  if (typeof str !== 'string') return str;
  const trimmed = str.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : str;
}

/**
 * Parse a Zo output (string — possibly fenced JSON — or a response object)
 * into the standard channel triple: reasoning, actions, plainText. Never
 * throws; unparseable strings degrade to plainText.
 *
 * @returns {{ reasoning: string, actions: Array, rawOutput: string, plainText: string, normalizedOutput: any }}
 */
export function parseZoOutput(output) {
  let reasoning = '';
  let actions = [];
  let rawOutput = '';
  let plainText = ''; // non-JSON answer text, surfaced directly to the user

  // Normalize to string for consistent parsing
  const normalizedOutput = (typeof output === 'object' && output !== null)
    ? output
    : String(output ?? '');

  if (typeof normalizedOutput === 'object' && normalizedOutput !== null) {
    reasoning = normalizedOutput.reasoning || '';
    actions = normalizeActions(normalizedOutput.actions);
    rawOutput = safeText(JSON.stringify(normalizedOutput));
  } else if (typeof normalizedOutput === 'string') {
    const fencedStripped = stripCodeFence(normalizedOutput);
    try {
      const parsed = JSON.parse(fencedStripped);
      if (parsed && typeof parsed === 'object') {
        reasoning = parsed.reasoning || '';
        actions = normalizeActions(parsed.actions);
        rawOutput = safeText(JSON.stringify(parsed));
      } else {
        // JSON but not an object (number/bool) — treat as plain text.
        plainText = safeText(normalizedOutput);
      }
    } catch {
      // Not JSON — this is a plain-text (markdown) answer. Show it directly
      // rather than routing through `reasoning` (ticket #29: plain-text
      // answers were only surfaced via reasoning and otherwise became "Done.").
      plainText = normalizedOutput;
    }
  }
  return { reasoning, actions, rawOutput, plainText, normalizedOutput };
}
