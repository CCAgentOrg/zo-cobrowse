// Link extraction — URLs from an assistant answer, for the link-chips card +
// "Open all (N)" (backlog #27 half 2). Pure logic, no chrome.* or DOM deps.
// Mirrors the markdown autolink rules of sidepanel.js#markdownToHtml so what
// renders as a link is exactly what gets extracted. See
// docs/superpowers/specs/2026-08-15-cold-start-open-all-design.md

import { hostOf } from './tab-contexts.js';

/** Max links the card shows / Open all opens (safe cap — no confirm step). */
export const MAX_LINK_CHIPS = 10;

/**
 * Bare-URL autolink pattern — the scheme rules of markdownToHtml's autolink
 * (lowercase http(s) only), but parens are allowed in the match so balanced
 * path parens survive; trimUrl() strips the unbalanced ones (GFM rule).
 */
const BARE_URL_RE = /(https?:\/\/[^\s<"'\]\>,;!?]+)/g;

/** Fenced code blocks never contribute links (code examples, not resources). */
const FENCED_RE = /```[\s\S]*?```/g;

/**
 * Trim trailing punctuation GFM-style: periods/commas/etc. always drop; a
 * trailing `)` drops only when the URL's parens are unbalanced.
 */
function trimUrl(u) {
  let s = u.replace(/[.,;:!?'<>]+$/, '');
  while (s.endsWith(')')) {
    const open = (s.match(/\(/g) || []).length;
    const close = (s.match(/\)/g) || []).length;
    if (close <= open) break;
    s = s.slice(0, -1).replace(/[.,;:!?'<>]+$/, '');
  }
  return s;
}

/**
 * Extract http(s) URLs from text in first-occurrence order, deduped by exact
 * URL. Sources: bare URLs (autolink) and markdown links — both funnel through
 * the same bare-URL pattern, so the two can't disagree. Fenced code blocks
 * are stripped first.
 *
 * @param {string} text
 * @returns {Array<{url: string, host: string}>}
 */
export function extractUrls(text) {
  const src = typeof text === 'string' ? text.replace(FENCED_RE, ' ') : '';
  const seen = new Set();
  const out = [];
  for (const m of src.matchAll(BARE_URL_RE)) {
    const url = trimUrl(m[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, host: hostOf(url) });
  }
  return out;
}
