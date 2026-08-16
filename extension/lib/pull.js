// Pull protocol — context-on-demand (#24). Pure logic, no chrome.* or DOM
// dependencies. Generalizes the read_tab follow-up loop: Zo emits a pull
// action (read_tab / read_page / get_dom / get_form) and the background
// fetches the requested context inside the same stream, re-injecting it as
// an auto follow-up turn (`## Auto-fetched:` — the active-page sibling of
// tab-contexts' `## Auto-attached:`). Heavy context travels on demand,
// complete and targeted, instead of budget-sliced into the prompt up front.

import { CONTEXT_ACTION_NAMES } from './modes.js';
import { hostOf, buildTabFollowUp, MAX_READ_TAB_CYCLES } from './tab-contexts.js';
import { compactEl, compactForm } from './prompt.js';

/** Pull action types — the context-only actions the loop intercepts. */
export const PULL_ACTION_NAMES = CONTEXT_ACTION_NAMES;

/** Max pull follow-up cycles per user turn, shared across ALL pull kinds. */
export const MAX_PULL_CYCLES = MAX_READ_TAB_CYCLES;

/** Render caps for get_dom follow-up bodies (lines). */
export const DOM_CLICKABLE_CAP = 200;
export const DOM_FORM_CAP = 150;

/** Capture tier each active-page pull kind needs (read_tab picks its own). */
export function pullTier(type) {
  return type === 'read_page' ? 1 : 2; // get_dom / get_form
}

/** Capture-shape hint threaded into getActiveTabContext({pull}). */
export function pullCaptureOpts(type) {
  const map = { read_page: 'page', get_dom: 'dom', get_form: 'form' };
  return { pull: map[type] || null };
}

/**
 * Extract validated pull requests from a Zo actions array, in order. One is
 * served per cycle (Zo re-asks for the next in its reply). Malformed entries
 * are ignored — never fatal, matching extractReadTabRequests.
 * @returns {Array<{type:'read_tab',ref:string}|{type:'read_page'|'get_dom'|'get_form'}>}
 */
export function extractPullRequests(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a) => a && typeof a === 'object' && PULL_ACTION_NAMES.includes(a.type))
    .map((a) => (a.type === 'read_tab'
      ? (typeof a.ref === 'string' && a.ref.trim() ? { type: 'read_tab', ref: a.ref.trim() } : null)
      : { type: a.type }))
    .filter(Boolean);
}

/**
 * Send-once hash for a pull kind. read_tab keeps the bare page hash (existing
 * tabsSent entries stay valid); the active-page kinds prefix their type so
 * get_dom and get_form on the same unchanged page each send once.
 */
export function pullHash(type, pageHash) {
  return type === 'read_tab' ? pageHash : `${type}:${pageHash}`;
}

/**
 * Build the auto follow-up `input` for one pull cycle. read_tab delegates to
 * buildTabFollowUp (tab semantics); the active-page kinds render their own
 * fenced bodies. Reason branches mirror buildTabFollowUp's kinds.
 *
 * @param {string} type  pull action type
 * @param {object} target  {title,url,host?} — read_tab also needs {ref}
 * @param {object|null} capture  pageContext-shaped ({visibleText,clickable,formFields}) or null
 * @param {{ textBudget?: number, reason?: 'duplicate'|'budget' }} [opts]
 * @returns {{ input: string, kind: 'content'|'unavailable'|'duplicate'|'budget'|'blank' }}
 */
export function buildPullFollowUp(type, target, capture, opts) {
  if (type === 'read_tab') return buildTabFollowUp(target, capture, opts);
  const o = opts || {};
  const t = target || {};
  const host = t.host || hostOf(t.url);
  const quoted = t.title ? `"${t.title}"` : host || t.url || 'current page';
  const label = type === 'read_page' ? 'page text'
    : type === 'get_dom' ? 'interactive elements' : 'form fields';
  const header = `## Auto-fetched: ${label} on ${quoted}${host ? ` — ${host}` : ''}`;
  const urlLine = t.url ? `- URL: ${t.url}` : '';
  const head = urlLine ? `${header}\n${urlLine}` : header;

  if (o.reason === 'budget') {
    return {
      input: `${head}\n(pull budget for this turn exhausted — wrap up with what you have)`,
      kind: 'budget',
    };
  }
  if (o.reason === 'blank') {
    return {
      input: `${head}\n(this page is a blank/new-tab page — nothing to read)`,
      kind: 'blank',
    };
  }
  if (o.reason === 'duplicate') {
    return {
      input: `${head}\n(this content was already provided above — continue with what you have)`,
      kind: 'duplicate',
    };
  }
  if (!capture || typeof capture !== 'object') {
    return {
      input: `${head}\n(page content could not be captured — continue with what you have)`,
      kind: 'unavailable',
    };
  }

  if (type === 'read_page') {
    const budget = Number.isInteger(o.textBudget) && o.textBudget > 0 ? o.textBudget : 12000;
    const text = String(capture.visibleText || '—empty—').substring(0, budget);
    return {
      input:
        `${head}\n` +
        '```text\n' +
        `${text}\n` +
        '```\n' +
        'Continue with the user\'s request using this content.',
      kind: 'content',
    };
  }

  const clickable = (Array.isArray(capture.clickable) ? capture.clickable : []).slice(0, DOM_CLICKABLE_CAP);
  const forms = (Array.isArray(capture.formFields) ? capture.formFields : []).slice(0, DOM_FORM_CAP);

  if (type === 'get_dom') {
    if (!clickable.length && !forms.length) {
      return {
        input: `${head}\n- no interactive elements found on this page\nContinue with the user's request.`,
        kind: 'content',
      };
    }
    const lines = [];
    if (clickable.length) {
      lines.push(`Clickable (${clickable.length}):`);
      for (const e of clickable) lines.push(compactEl(e));
    }
    if (forms.length) {
      if (lines.length) lines.push('');
      lines.push(`Form fields (${forms.length}):`);
      for (const f of forms) lines.push(compactForm(f));
    }
    return {
      input:
        `${head}\n` +
        '```text\n' +
        `${lines.join('\n')}\n` +
        '```\n' +
        'Continue with the user\'s request using this element map.',
      kind: 'content',
    };
  }

  // get_form
  if (!forms.length) {
    return {
      input: `${head}\n- no form fields found on this page\nContinue with the user's request.`,
      kind: 'content',
    };
  }
  const flines = forms.map((f) => compactForm(f));
  return {
    input:
      `${head}\n- ${forms.length} form fields\n` +
      '```text\n' +
      `${flines.join('\n')}\n` +
      '```\n' +
      'Continue with the user\'s request using this form schema.',
    kind: 'content',
  };
}
