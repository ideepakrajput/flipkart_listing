/* GoProVeda Listing Assistant - page-side filler.
 *
 * SAFETY CONTRACT (do not weaken):
 *  - Fills form fields only. NEVER clicks submit / "Send to QC" / "Save",
 *    and never navigates.
 *  - Every fill is triggered by an explicit user click in the side panel.
 *  - Reads only the listing form already on screen. No scraping, no paging,
 *    no network requests of any kind.
 */
(() => {
  'use strict';
  if (window.__gpvFillerLoaded) return;
  window.__gpvFillerLoaded = true;

  const norm = (s) =>
    String(s || '').replace(/[* ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- React-safe value setting ---------------------------------- */
  function setNativeValue(el, value) {
    const text = String(value);
    if (el instanceof HTMLInputElement &&
        ((el.type === 'number' && text !== '' && !Number.isFinite(Number(text))) ||
         (el.type === 'date' && text !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(text)))) {
      throw new Error(`Refused invalid ${el.type} value "${text}".`);
    }
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const own = Object.getOwnPropertyDescriptor(el, 'value')?.set;
    if (setter && setter !== own) setter.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const visible = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };

  /* ---------- Popups ----------------------------------------------------
   * An OPEN dropdown renders a floating panel that contains a search box and
   * the option list. Everything inside it must be invisible to the scanner,
   * or its option text gets mistaken for field labels.                     */
  function isInPopup(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const role = n.getAttribute?.('role');
      if (role === 'listbox' || role === 'menu' || role === 'dialog') return true;
      // A floating layer only counts as a popup if it is SMALL - an option list
      // holds a search box at most. The form itself can also be positioned, and
      // may contain option nodes for its closed dropdowns; treating that as a
      // popup would hide every field on the page.
      if (n.querySelector?.('[role="option"]')) {
        const cs = getComputedStyle(n);
        if ((cs.position === 'absolute' || cs.position === 'fixed') &&
            n.querySelectorAll('input,textarea,select').length <= 2) return true;
      }
    }
    return false;
  }

  const CONTROL_SEL =
    'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),' +
    'textarea, select, [role="combobox"]';

  // Flipkart renders most dropdowns as a plain <div> with a value/placeholder
  // and a chevron - no <select>, no role. Find those structurally.
  function looksLikeDropdown(el) {
    if (el.querySelector('input,textarea,select,button,a')) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 28 || r.height > 62 || r.width < 110) return false;

    // A real control has a visible box. Label cells and section headings do not.
    const cs = getComputedStyle(el);
    const bw = Math.max(parseFloat(cs.borderTopWidth) || 0,
                        parseFloat(cs.borderBottomWidth) || 0,
                        parseFloat(cs.borderLeftWidth) || 0);
    if (bw < 0.5) return false;

    // The chevron sits at the RIGHT edge. An "i" info icon sits beside the
    // label on the LEFT - that is what was turning label cells into "dropdowns".
    const icon = el.querySelector('svg,[class*="arrow" i],[class*="chevron" i],[class*="caret" i]');
    if (!icon) return false;
    const ir = icon.getBoundingClientRect();
    if (ir.left < r.left + r.width * 0.6) return false;

    const txt = (el.innerText || '').trim();
    if (!txt || txt.length > 40 || txt.includes('\n')) return false;
    return true;
  }

  function divDropdowns() {
    const out = [];
    for (const el of document.querySelectorAll('div,span')) {
      if (!visible(el) || isInPopup(el)) continue;
      if (!looksLikeDropdown(el)) continue;
      // Keep only the innermost such box, so we don't also collect its wrappers.
      if (out.some((o) => el.contains(o))) continue;
      out.push(el);
    }
    return out.filter((el) => !out.some((o) => o !== el && el.contains(o)));
  }

  // The Seller Hub chrome (top search box, nav) is not part of the listing form.
  function isChrome(el) {
    if (el.closest?.('header,nav,[class*="header" i],[class*="navbar" i]')) return true;
    const ph = (el.getAttribute?.('placeholder') || '').trim();
    if (/^search\b/i.test(ph)) return true;
    return false;
  }

  let _cache = null;
  const controls = () => {
    if (_cache) return _cache;
    const native = Array.from(document.querySelectorAll(CONTROL_SEL))
      .filter((e) => visible(e) && !isInPopup(e) && !isChrome(e));
    const custom = divDropdowns()
      .filter((d) => !native.some((n) => d.contains(n)) && !isChrome(d));
    _cache = native.concat(custom);
    setTimeout(() => { _cache = null; }, 0);   // valid for this tick only
    return _cache;
  };
  const invalidate = () => { _cache = null; };

  /* ---------- Rows: pair each control with the label beside it -----------
   * We walk UP from the control until the ancestor holds exactly one control
   * (that's the field row), then read the row's text minus the control's own
   * text and minus any open popup. The first line of what's left is the label.
   */
  function rowFor(ctrl) {
    const all = controls();
    let node = ctrl.parentElement, best = null;
    for (let d = 0; d < 7 && node && node !== document.body; d++, node = node.parentElement) {
      const n = all.filter((c) => node.contains(c)).length;
      if (n === 1) best = node;
      else if (n > 1) break;
    }
    return best;
  }

  const UNIT_RX = /^(inr|cm|kg|g|day|days|months?|percentage|%)$/i;

  const SKIP_TEXT_RX =
    /^find |^minimum \d|^click |^don'?t want|^multiple values|^mandatory|^search |^\*$/i;

  // Every short, visible piece of on-screen text, with its box.
  function textBoxes() {
    const out = [];
    for (const el of document.querySelectorAll(
      'div,span,label,p,td,th,strong,b,h1,h2,h3,h4,h5,h6')) {
      if (!visible(el) || isInPopup(el)) continue;
      let t = '';
      for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
      t = t.replace(/\s+/g, ' ').replace(/\*/g, '').trim();
      if (!t || t.length > 60) continue;
      if (UNIT_RX.test(t) || SKIP_TEXT_RX.test(t)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      out.push({ el, text: t, rect });
    }
    return out;
  }

  // A form label is the text to the LEFT of the control on the same row - which
  // is exactly how the form reads on screen. Geometry beats DOM nesting here:
  // it does not care how Flipkart wraps its markup.
  function labelByGeometry(ctrl, texts) {
    return labelScored(ctrl, texts).text;
  }

  function labelScored(ctrl, texts) {
    const r = ctrl.getBoundingClientRect();
    let best = null, bestGap = Infinity;

    for (const t of texts) {
      if (t.el.contains(ctrl) || ctrl.contains(t.el)) continue;
      const vOverlap = Math.min(t.rect.bottom, r.bottom) - Math.max(t.rect.top, r.top);
      if (vOverlap <= 2) continue;                   // not on this row
      if (t.rect.right > r.left + 4) continue;       // not to the left
      const gap = r.left - t.rect.right;
      if (gap < bestGap) { bestGap = gap; best = t; }
    }
    if (best && bestGap < 420) return { text: best.text, dist: bestGap };

    // Fallback: a label sitting directly above the control (stacked layouts).
    let above = null, bestDy = Infinity;
    for (const t of texts) {
      if (t.el.contains(ctrl) || ctrl.contains(t.el)) continue;
      const hOverlap = Math.min(t.rect.right, r.right) - Math.max(t.rect.left, r.left);
      if (hOverlap <= 4) continue;
      const dy = r.top - t.rect.bottom;
      if (dy >= -2 && dy < bestDy) { bestDy = dy; above = t; }
    }
    return above && bestDy < 60 ? { text: above.text, dist: 500 + bestDy } : { text: '', dist: Infinity };
  }

  function labelFor(ctrl, texts) {
    const aria = ctrl.getAttribute('aria-label');
    if (aria && !UNIT_RX.test(aria.trim())) return aria.trim();
    if (ctrl.id) {
      const l = document.querySelector(`label[for="${CSS.escape(ctrl.id)}"]`);
      const t = l?.innerText.trim();
      if (t) return t;
    }
    return labelByGeometry(ctrl, texts || textBoxes());
  }

  // A unit picker ("g", "Months") sits to the right of its value box and would
  // otherwise steal that field's label.
  const kindOf = (el) => {
    if (el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox') return 'dropdown';
    if (el.tagName === 'INPUT' && el.readOnly) return 'dropdown';
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return 'dropdown'; // div-based
    if (el.type === 'date') return 'date';
    return el.tagName === 'TEXTAREA' ? 'textarea' : 'text';
  };

  const isUnitPicker = (el) => UNIT_RX.test((el.innerText || '').trim());

  /* One label owns exactly one control: the closest one. A second control on the
   * same row is either a unit picker (renamed) or a duplicate (dropped), so a
   * value can never land in the wrong box. */
  function fieldMap() {
    const texts = textBoxes();
    const scored = [];
    for (const el of controls()) {
      const { text, dist } = labelScored(el, texts);
      if (!text) continue;
      const unit = kindOf(el) === 'dropdown' && isUnitPicker(el);
      scored.push({ el, label: unit ? `${text} unit` : text, dist, unit });
    }
    scored.sort((a, b) => a.dist - b.dist);

    const map = new Map();
    let dropped = 0;
    for (const c of scored) {
      const key = norm(c.label);
      if (map.has(key)) { dropped++; continue; }
      map.set(key, { el: c.el, label: c.label, kind: kindOf(c.el) });
    }
    return { map, dropped, total: scored.length };
  }

  let scannedMap = new Map();

  function scanFields() {
    const { map, dropped } = fieldMap();
    scannedMap = map;
    const vertical = new URLSearchParams(location.hash.split('?')[1] || '').get('vertical');
    return {
      fields: Array.from(map.entries()).map(([key, v]) => ({
        key, label: v.label, kind: v.kind, count: 1,
      })),
      total: controls().length,
      unlabelled: dropped,
      vertical,
    };
  }


  function controlFor(key) {
    const scanned = scannedMap.get(key)?.el;
    if (scanned?.isConnected) return scanned;
    const fresh = fieldMap().map;
    scannedMap = fresh;
    return fresh.get(key)?.el || null;
  }

  /* ---------- Dropdowns -------------------------------------------------- */
  const MENU_SEL = 'input,[role="option"],li,div,span';
  const onScreen = (el) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };

  // Only consider controls/options that became visible after this dropdown was
  // clicked. Seller Hub keeps unrelated header suggestions in the DOM, so a
  // global option search can otherwise select the LID/Rate Card search popup.
  const newlyVisible = (before) => Array.from(document.querySelectorAll(MENU_SEL))
    .filter((n) => onScreen(n) && !before.has(n));

  function dropdownOptions(before) {
    const nodes = newlyVisible(before).filter((n) => {
      const text = (n.innerText || '').trim();
      return n.tagName !== 'INPUT' && !n.querySelector('input') &&
             text && text.length < 60;
    });
    // Prefer the innermost node for each option; clicking it bubbles to the
    // option wrapper and avoids treating the whole menu as one option.
    return nodes.filter((n) => !nodes.some((o) => o !== n && n.contains(o) &&
      norm(o.innerText) === norm(n.innerText)));
  }

  async function setDropdown(el, value) {
    if (el.tagName === 'SELECT') {
      const want = norm(value);
      const opt = Array.from(el.options)
        .find((o) => norm(o.text) === want || norm(o.value) === want);
      if (!opt) {
        return { ok: false,
          reason: `"${value}" is not an option. Available: ${Array.from(el.options)
            .map((o) => o.text.trim()).filter(Boolean).slice(0, 8).join(', ')}` };
      }
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }

    invalidate();
    document.body.click();                 // close any menu the user left open
    await sleep(60);
    const before = new Set(Array.from(document.querySelectorAll(MENU_SEL)).filter(onScreen));
    const opener = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      ? (el.parentElement || el) : el;
    opener.click();
    await sleep(280);

    let opened = newlyVisible(before);
    if (!opened.length && opener !== el) {
      el.click();
      await sleep(300);
      opened = newlyVisible(before);
    }
    if (!opened.length) return { ok: false, reason: 'The dropdown did not open. Pick it manually.' };

    // Type into the panel's search box to narrow long lists (Country, Flavor…).
    const search = opened.find((n) => n.tagName === 'INPUT' &&
      ['text', 'search'].includes(n.type));
    if (search) {
      search.focus();
      search.setRangeText(String(value), 0, search.value.length, 'end');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(320);
    }

    const want = norm(value);
    const opts = dropdownOptions(before);
    let hit = opts.find((o) => norm(o.innerText) === want);
    if (!hit) {
      const near = opts.filter((o) => norm(o.innerText).startsWith(want));
      if (near.length === 1) hit = near[0];
    }
    if (!hit) {
      const sample = opts.map((o) => o.innerText.trim()).filter(Boolean).slice(0, 8).join(', ');
      document.body.click();
      return { ok: false, reason: `No option "${value}". Saw: ${sample || '(none)'}` };
    }
    hit.click();
    await sleep(140);
    return { ok: true };
  }

  function flash(el, ok) {
    const cls = ok ? 'gpv-hit' : 'gpv-miss';
    el.classList?.add(cls);
    setTimeout(() => el.classList?.remove(cls), 2000);
  }

  /* ---------- Fill one --------------------------------------------------- */
  async function fillOne({ label, value }, target) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return { label, ok: false, reason: 'Empty value.' };
    }
    invalidate();
    const key = norm(label);
    const found = target?.isConnected ? target : controlFor(key);
    if (!found) return { label, ok: false, reason: 'Field not found on this tab.' };
    const el = found;
    // Move immediately: a continuing smooth scroll makes unrelated form inputs
    // appear after the dropdown snapshot and look like part of its popup.
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    await sleep(120);

    let res;
    try {
      if (kindOf(el) === 'dropdown') {
        res = await setDropdown(el, String(value));
      } else if (el.type === 'date') {
        // <input type=date> needs yyyy-mm-dd regardless of how it displays.
        const m = String(value).match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
        setNativeValue(el, m ? `${m[3]}-${m[2]}-${m[1]}` : String(value));
        res = { ok: !!el.value, reason: el.value ? '' : 'Date rejected - use dd/mm/yyyy.' };
      } else {
        setNativeValue(el, String(value));
        res = norm(el.value) === norm(value)
          ? { ok: true }
          : { ok: false, reason: `Value did not stick (field shows "${el.value}").` };
      }
    } catch (e) {
      res = { ok: false, reason: String(e.message || e) };
    }
    flash(el, res.ok);
    return { label, ok: res.ok, reason: res.reason };
  }

  /* ---------- Messages --------------------------------------------------- */
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    (async () => {
      try {
        if (msg.action === 'PING') sendResponse({ ok: true, url: location.href });
        else if (msg.action === 'DUMP') {
          const rows = [];
          const texts = textBoxes();
          for (const el of controls().slice(0, 12)) {
            const row = rowFor(el);
            rows.push({
              label: labelFor(el, texts),
              kind: kindOf(el),
              tag: el.tagName.toLowerCase(),
              html: (row || el).outerHTML.slice(0, 1200),
            });
          }
          sendResponse({ ok: true, rows, total: controls().length });
        }
        else if (msg.action === 'SCAN') sendResponse({ ok: true, ...scanFields() });
        else if (msg.action === 'FILL_ONE') sendResponse({ ok: true, result: await fillOne(msg.field) });
        else if (msg.action === 'FILL_MANY') {
          // Resolve every target from the user's successful scan before writes
          // move or re-render the form. Fill text first so dropdown React updates
          // cannot invalidate the ordinary inputs that follow them.
          const jobs = msg.fields.map((field, index) => ({
            field, index, target: controlFor(norm(field.label)),
          })).sort((a, b) =>
            Number(a.target && kindOf(a.target) === 'dropdown') -
            Number(b.target && kindOf(b.target) === 'dropdown'));
          const results = new Array(msg.fields.length);
          for (const { field, index, target } of jobs) {
            invalidate();
            results[index] = await fillOne(field, target);
            await sleep(130);
          }
          sendResponse({ ok: true, results });
        } else sendResponse({ ok: false, error: `Unknown action ${msg.action}` });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  });
})();
