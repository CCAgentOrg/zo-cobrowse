// Form-fill heuristics (#26) — pure logic. What makes a form "sensitive"
// (needs the review card) and how proposed values are masked for display.
// Conservative by design: a false positive costs one review click; a false
// negative auto-fills a sensitive form.

// "ccnum"/"exp-date" variants cover real-world card-field names ("ccnumber",
// "exp_month") that the bare "card"/"expir" stems miss — the #26 plan's own
// truth-table test pinned these. "password" covers label-only password rows
// whose captured metadata couldn't be joined (no placeholder/name match).
const SENSITIVE_FIELD_RE = /password|card|cc[-_.\s]?num|ccv|cvc|cvv|expir|exp[-_.\s]?(date|month|mo|year|yr)|ssn|social|security|tax|pin\b|passport|licen[cs]e/i;
const SENSITIVE_URL_RE = /login|signin|sign-in|signup|sign-up|register|checkout|payment|billing|account|password|banking/i;

/**
 * @param {Array<{type?:string,name?:string,placeholder?:string}>|null} fields — get_form-shape capture
 * @param {string|null} url
 * @returns {{sensitive:boolean,reasons:string[]}}
 */
export function isSensitiveForm(fields, url) {
  const reasons = [];
  for (const f of Array.isArray(fields) ? fields : []) {
    const type = String((f && f.type) || '').toLowerCase();
    const surface = `${(f && f.name) || ''} ${(f && f.placeholder) || ''}`.toLowerCase();
    if (type === 'password') { reasons.push('password field'); break; }
    if (SENSITIVE_FIELD_RE.test(surface)) { reasons.push(`sensitive field "${(f && (f.name || f.placeholder)) || type}"`); break; }
  }
  if (!reasons.length && SENSITIVE_URL_RE.test(String(url || ''))) reasons.push('sensitive page URL');
  return { sensitive: reasons.length > 0, reasons };
}

/** Mask for display. Never used as a value — values come only from the model/user. */
export function redactValue(value) {
  const v = String(value == null ? '' : value);
  if (!v) return '';
  return v.length >= 4 ? '••••' + v.slice(-2) : '••••';
}

/**
 * Join a fill_form action's proposed values with captured field metadata for
 * the review card. Secret rows (password-type or sensitive-named) carry an
 * EMPTY value — the card shows "left for you", the user's password manager
 * owns secrets.
 */
export function reviewRows(action, fields) {
  const caps = Array.isArray(fields) ? fields : [];
  const findMeta = (v) => caps.find((f) =>
    (f.placeholder && f.placeholder === v.target) ||
    (f.question && f.question === v.target) ||
    (f.name && f.name === v.target) ||
    (v.selector && f.selector === v.selector)) || null;
  return (action.values || []).map((v) => {
    const meta = findMeta(v);
    const type = String((meta && meta.type) || '').toLowerCase();
    const secret = type === 'password' || SENSITIVE_FIELD_RE.test(String(v.target));
    return {
      target: v.target,
      value: secret ? '' : String(v.value == null ? '' : v.value),
      type,
      secret,
      redacted: redactValue(v.value),
    };
  });
}
