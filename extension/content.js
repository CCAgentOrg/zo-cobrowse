// Zo Co-browse — Content Script
// Captures page context and executes browser actions

(function () {
  const PAGE_DEAD = /^(about:|chrome-extension:|file:)/;

  function isAlive() {
    return !PAGE_DEAD.test(location.protocol);
  }

  /** Grab structured page context for Zo's AI.
   *  tier 0 = URL/title/viewport only; 1 = +visibleText; 2 = +clickable+forms.
   *  (Screenshots for tier 3 are captured separately by the background.) */
  function captureContext(tier) {
    const t = (typeof tier === 'number' && tier >= 0 && tier <= 3) ? tier : 2;
    const maxTextLen = 8000;
    const doc = document;

    const base = {
      url: location.href,
      title: doc.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    if (t === 0) return base;

    // Structured visible text — prefer <main>/<article>, fallback to body
    const mainEl = doc.querySelector('main, article, [role="main"], #content, .content');
    const bodyText = (mainEl || doc.body)?.innerText || '';
    const visibleText = bodyText.substring(0, maxTextLen);
    const out = { ...base, visibleText };
    if (t === 1) return out;

    // Form field summary (for fill actions)
    const formFields = [];
    doc.querySelectorAll('input, textarea, select').forEach((el) => {
      if (el.type === 'hidden') return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      formFields.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || 'text',
        name: el.name || el.id || '',
        selector: buildSelector(el),
        placeholder: el.placeholder || '',
        value: el.value?.substring(0, 100) || '',
      });
    });

    // Interactive elements map (for click targeting)
    const clickableEls = [];
    doc.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const text = (el.textContent || el.value || '').trim().substring(0, 60);
      if (!text) return;
      clickableEls.push({ text, tag: el.tagName.toLowerCase(), selector: buildSelector(el) });
    });

    out.formFields = formFields.slice(0, 30);
    out.clickable = clickableEls.slice(0, 50);
    out.documentSize = { w: doc.documentElement.scrollWidth, h: doc.documentElement.scrollHeight };
    return out;
  }

  /** Build a simple CSS selector for an element */
  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name && el.tagName.match(/^(INPUT|TEXTAREA|SELECT)$/i))
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3);
      if (classes.length) sel += classes.map((c) => `.${CSS.escape(c)}`).join('');
    }
    // Disambiguate with nth-child if ambiguous
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === el.tagName
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        sel += `:nth-child(${idx})`;
      }
    }
    return sel;
  }

  /** Wait for an element to appear in DOM */
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element not found: ${selector}`));
      }, timeout);
    });
  }

  /** Execute a single action */
  async function executeAction(action) {
    switch (action.type) {
      case 'click': {
        const el = await waitForElement(action.selector);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        el.click();
        return { ok: true, type: 'click' };
      }
      case 'fill': {
        const el = (await waitForElement(action.selector)) 
        el.focus();
        el.value = '';
        el.value = action.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, type: 'fill' };
      }
      case 'extract': {
        const el = await waitForElement(action.selector);
        const val = action.attribute
          ? el.getAttribute(action.attribute)
          : el.textContent?.trim();
        return { ok: true, type: 'extract', value: val || '' };
      }
      case 'scroll': {
        const amount = action.amount || window.innerHeight * 0.7;
        const x = 0;
        const y = action.direction === 'up' ? -amount : amount;
        window.scrollBy({ left: x, top: y, behavior: 'smooth' });
        return { ok: true, type: 'scroll' };
      }
      case 'wait':
        await sleep(action.ms || 1000);
        return { ok: true, type: 'wait' };
      case 'navigate':
        // Navigation is normally handled by the background (chrome.tabs.update),
        // but accept it here as a no-op success so a forwarded action never
        // reports a false failure.
        return { ok: true, type: 'navigate' };
      case 'done':
        // Terminal action — no DOM work, just signal completion.
        return { ok: true, type: 'done', response: action.response || '' };
      default:
        return { ok: false, error: `Unknown action type: ${action.type}` };
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Listen for messages from background/service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case 'CAPTURE_CONTEXT':
        sendResponse(isAlive() ? captureContext(request.tier) : { error: 'Extension context unavailable' });
        break;
      case 'EXECUTE_ACTION':
        if (request.actions && Array.isArray(request.actions)) {
          Promise.all(request.actions.map(executeAction))
            .then((results) => sendResponse({ ok: true, results }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
          return true; // async
        }
        executeAction(request.action)
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true; // async
      default:
        // Unknown request type — respond cleanly so the caller's
        // sendMessage promise doesn't reject with "message port closed".
        sendResponse({ ok: false, error: `Unknown request type: ${request.type}` });
        break;
    }
  });
})();
