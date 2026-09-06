import { listModels, extract, fileToInlineData } from '../lib/gemini.js';

const $ = (id) => document.getElementById(id);
const state = {
  seed: null, images: [], formLabels: [], formFields: [], drafted: [],
  busy: false, abortController: null,
};

const setStatus = (t) => { $('status').textContent = t || ''; };

/* ---------- settings --------------------------------------------------- */
async function loadSettings() {
  const s = await chrome.storage.local.get(['apiKey', 'model']);
  $('apiKey').value = s.apiKey || '';
  if (s.model) $('model').innerHTML = `<option selected>${s.model}</option>`;
  if (!s.apiKey) {
    $('settings').hidden = false;
    setStatus('Add your Gemini API key to begin.');
  } else if (!s.model) {
    // Key but no model yet - fetch the list so the user isn't stuck on the placeholder.
    $('settings').hidden = false;
    await fetchModels();
  }
  return s;
}
$('settingsBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; };
$('saveSettings').onclick = async () => {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) return setStatus('Paste your Gemini API key first.');
  let model = $('model').value;
  if (!model) {                       // still on the placeholder - fetch the list for them
    if (!(await fetchModels())) return;
    model = $('model').value;
  }
  await chrome.storage.local.set({ apiKey, model });
  $('settings').hidden = true;
  setStatus(`Saved. Using ${model}.`);
};
async function fetchModels() {
  const key = $('apiKey').value.trim();
  if (!key) { setStatus('Enter the API key first.'); return false; }
  setStatus('Loading models…');
  try {
    const models = await listModels(key);
    if (!models.length) { setStatus('That key returned no usable Gemini models.'); return false; }
    const saved = (await chrome.storage.local.get('model')).model;
    const preferred = (saved && models.includes(saved)) ||
                      models.find((m) => /2\.5-flash$/.test(m)) ||
                      models.find((m) => /flash/.test(m)) || models[0];
    const pick = typeof preferred === 'string' ? preferred : saved;
    $('model').innerHTML = models
      .map((m) => `<option${m === pick ? ' selected' : ''}>${m}</option>`).join('');
    await chrome.storage.local.set({ model: $('model').value });
    setStatus(`${models.length} models available — using ${$('model').value}.`);
    return true;
  } catch (e) { setStatus(e.message); return false; }
}
$('loadModels').onclick = fetchModels;
$('model').onchange = () => chrome.storage.local.set({ model: $('model').value });

/* ---------- seed ------------------------------------------------------- */
async function loadSeed() {
  state.seed = await (await fetch(chrome.runtime.getURL('seed/patterns.json'))).json();
  const cats = Object.keys(state.seed.categories);
  $('category').innerHTML =
    '<option value="" disabled selected>— select the Seller Hub category —</option>' +
    cats.map((c) => `<option value="${c}">${c}</option>`).join('') +
    '<option value="__other__">other / new category — no defaults</option>';
  showCatHint();
  const issues = state.seed.data_issues || [];
  if (issues.length) {
    $('warn').hidden = false;
    $('warn').innerHTML =
      `<b>${issues.length} issues in your existing listings</b> (from the export — fix in Seller Hub):<ul>` +
      issues.map((i) => `<li><code>${i.sku}</code> — ${i.detail}</li>`).join('') + '</ul>';
  }
}
function showCatHint() {
  const key = $('category').value;
  if (!key) {
    $('catHint').textContent = 'Choose the category shown under Select Vertical in Seller Hub.';
    return;
  }
  if (key === '__other__') {
    $('catHint').textContent =
      'No existing listings to learn from. Nothing will be pre-filled — every value ' +
      'comes from the label photos, so check HSN, tax code and package size by hand.';
    return;
  }
  const c = state.seed.categories[key];
  const bad = Object.keys(c.inconsistent || {});
  $('catHint').textContent =
    `${c.n_listings} existing listings. Defaults will be pre-filled.` +
    (bad.length ? ` Inconsistent across your catalogue: ${bad.join(', ')}.` : '');
}
$('category').onchange = () => { showCatHint(); refreshAnalyse(); };

/* ---------- images ----------------------------------------------------- */
$('files').onchange = (e) => {
  state.images = Array.from(e.target.files);
  $('thumbs').innerHTML = '';
  for (const f of state.images) {
    const img = new Image();
    img.src = URL.createObjectURL(f);
    img.title = f.name;
    $('thumbs').append(img);
  }
  refreshAnalyse();
};

/* ---------- talk to the page ------------------------------------------- */
function toPage(payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: 'RELAY_TO_PAGE', payload }, (r) =>
      resolve(r || { ok: false, error: 'No response from the page.' })));
}

$('scan').onclick = async () => {
  setStatus('Scanning the form…');
  const r = await toPage({ action: 'SCAN' });
  if (!r.ok) { $('scanHint').textContent = r.error; return setStatus(''); }
  if (r.vertical && state.seed.categories[r.vertical]) {
    $('category').value = r.vertical;
    showCatHint();
  }
  // Keep every labelled field. Duplicates are still offered - fillOne reports
  // the ambiguity rather than guessing which box to write into.
  state.formFields = r.fields || [];
  state.formLabels = state.formFields.map((f) => f.label);
  const drops = state.formFields.filter((f) => f.kind === 'dropdown').length;
  const units = state.formFields.filter((f) => / unit$/i.test(f.label)).length;
  $('scanHint').textContent =
    `${state.formFields.length - units} labelled fields` +
    (units ? ` + ${units} unit controls` : '') + ` (${drops} dropdowns) ` +
    `from ${r.total} controls` +
    (r.duplicates ? `; ${r.duplicates} duplicate control(s) ignored` : '') +
    (r.unlabelled ? `; ${r.unlabelled} unlabelled control(s) ignored` : '') +
    '. Switch tabs in Seller Hub and rescan to cover the rest.';
  renderScanned();
  refreshAnalyse();
  setStatus('');
};

$('dump').onclick = async () => {
  setStatus('Reading the form markup…');
  const r = await toPage({ action: 'DUMP' });
  if (!r.ok) return setStatus(r.error);
  const text = `${r.total} controls detected\n\n` + r.rows
    .map((x) => `--- label="${x.label}" kind=${x.kind} tag=${x.tag}\n${x.html}`)
    .join('\n\n');
  await navigator.clipboard.writeText(text);
  setStatus(`Copied markup for ${r.rows.length} of ${r.total} controls. Paste it to Claude.`);
};

function refreshAnalyse() {
  const category = $('category').value;
  const ready = category && state.images.length > 0 && state.formLabels.length > 0 && !state.busy;
  $('analyse').disabled = !ready;
  $('cancelAnalyse').hidden = !state.busy;
  $('cancelAnalyse').disabled = !state.busy;
  $('analyseHint').textContent = !category
    ? 'Select the matching Seller Hub category first.'
    : state.formLabels.length
    ? (state.images.length ? '' : 'Add at least one label photo.')
    : 'Scan the form first.';
}

function renderScanned() {
  const box = $('scanned');
  if (!state.formFields.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML =
    '<b>Fields found on this tab</b><ul>' +
    state.formFields.map((f) =>
      `<li><code>${f.label}</code> <span class="badge">${f.kind}</span>` +
      (f.count > 1 ? ` <span class="badge low">x${f.count}</span>` : '') + '</li>').join('') +
    '</ul>';
}

/* ---------- allowed values -------------------------------------------- */
const nkey = (s) => String(s || '').replace(/[*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function allowedFor(label) {
  const want = nkey(label);
  const pools = [state.seed.ui_dropdowns || {}];
  for (const t of Object.values(state.seed.catalog_templates || {})) pools.push(t.dropdowns || {});
  for (const pool of pools) {
    for (const [k, v] of Object.entries(pool)) {
      if (nkey(k) === want) return v;
    }
  }
  return null;
}

/* ---------- prompt ----------------------------------------------------- */
function buildPrompt(cat) {
  const known = cat !== '__other__';
  const c = known ? state.seed.categories[cat] : { defaults: {} };
  const ex = known ? (state.seed.title_examples[cat] || []).slice(0, 6)
                   : Object.values(state.seed.title_examples).flat().slice(0, 6);
  const skuExamples = known ? (state.seed.sku_examples?.[cat] || []).slice(0, 20) : [];
  return `You are filling a Flipkart Seller Hub listing form for an Indian seller.

Read the attached product-label photographs and produce values for the form fields listed below.

RULES
- Transcribe what is printed on the label. Do NOT invent an FSSAI number, a
  net weight, a manufacturer address, a batch number or a date. If a value is
  not legible on the label, omit that field entirely.
- For Manufacturing date, read MFD, PKD, packed-on or manufacturing date from
  the photos. Return dd/mm/yyyy. If only month/year is printed, use day 01.
  Never reuse a manufacturing date from an older listing.
- Match the house style of the existing listings shown below.
- Multi-value fields must be separated by a double colon (::), e.g. "A::B::C".
- For Nutrient Content, inspect the nutrition panel carefully and return every
  legible "name: value" item separated by ::. Do not omit it when the panel is
  readable, and do not invent values that are not visible.
- Quantity is the total net quantity printed on the pack and must contain only
  the number. Put its unit in the separate Quantity unit dropdown.
- Maximum Shelf Life must contain only the number. Put Months/Days in its
  separate unit dropdown.
- Weight fields use kilograms. Convert label grams to kilograms (for example,
  400 g becomes 0.4), and return only the number. Dimensions use centimetres.
- Always return usage_instructions separately. Copy the label instruction when
  present; otherwise write one short, conservative instruction appropriate to
  the actual product shown in the photos. Never return "none".
- Draft every descriptive field that can safely be inferred from the product
  and photos, especially Description, Items Included, Key Features, Search
  Keywords, Key Specs and Other Features. Omit only identifiers, measurements,
  certifications and regulated claims that are not visible on the label.
- Do not put the SKU code inside any title or name field.
- Brand is exactly "Promishor". Never append product words to the brand.
- Always generate Seller SKU ID when that field is listed. Reuse an existing
  abbreviation for the same product; otherwise coin one uppercase abbreviation
  from the product name and follow the SKU convention exactly.
- Reply only with fields you can actually determine.

FORM FIELDS TO FILL (use these labels verbatim, one entry each):
${state.formFields.map((f) => {
  const opts = allowedFor(f.label);
  const kind = f.kind === 'dropdown' ? 'DROPDOWN' : f.kind === 'date' ? 'DATE dd/mm/yyyy' : 'text';
  return `- ${f.label}  [${kind}]` +
    (opts ? `  MUST be exactly one of: ${opts.join(' | ')}` : '');
}).join('\n')}

A DROPDOWN value that is not in its allowed list will be rejected by the form.
If you cannot pick a listed option confidently, omit that field.

SKU CONVENTION: ${state.seed.sku_convention.pattern}
Form codes: ${JSON.stringify(state.seed.sku_convention.forms)}
${state.seed.sku_convention.note}
Known abbreviations already in use (reuse these, do not coin duplicates):
${JSON.stringify(state.seed.abbrev_to_products, null, 0).slice(0, 1800)}
Existing valid SKUs in this category:
${JSON.stringify(skuExamples, null, 0).slice(0, 2200)}

${known
  ? `HOUSE DEFAULTS for category "${cat}" (use unless the label clearly disagrees):
${JSON.stringify(c.defaults, null, 1)}`
  : `This is a NEW category with no house defaults. Do not guess HSN codes, tax
codes or package dimensions - omit those fields and let the seller set them.`}

EXAMPLE TITLES from this seller's existing catalogue:
${ex.map((e) => `- ${e.sku}: ${e.title}`).join('\n')}

For every field return: the exact label, the value, a confidence of
high/medium/low, and a short source note ("read off back label", "house
default", "inferred from product type"). Also return seller_sku_id separately,
using exactly {ABBREV}{FORM}_P{packOf}_{quantity}{UNIT}, uppercase with no spaces.`;
}

const SCHEMA = {
  type: 'object',
  properties: {
    seller_sku_id: {
      type: 'string',
      description: 'Generated uppercase SKU such as DRJGRLVT_P1_100G',
    },
    usage_instructions: {
      type: 'string',
      description: 'One short label-derived or conservative product-specific usage instruction',
    },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          source: { type: 'string' },
        },
        required: ['label', 'value', 'confidence', 'source'],
      },
    },
  },
  required: ['seller_sku_id', 'usage_instructions', 'fields'],
};

// Seed keys come from Seller Hub exports, while the live form uses shorter
// labels. Merge these established per-category defaults locally so Gemini
// cannot omit a known value from an otherwise good photo extraction.
const DEFAULT_LABELS = {
  mrp: ['mrp'],
  selling_price: ['your selling price'],
  fulfilment_by: ['fulfilment by', 'fulfillment by', 'fullfilment by'],
  procurement_sla: ['procurement sla'],
  procurement_type: ['procurement type'],
  length_cm: ['length'],
  breadth_cm: ['breadth'],
  height_cm: ['height'],
  weight_kg: ['weight'],
  local_fee: ['local handling fee'],
  zonal_fee: ['zonal handling fee'],
  national_fee: ['national handling fee'],
  hsn: ['hsn'],
  tax_code: ['tax code'],
  country_of_origin: ['country of origin'],
  manufacturer_details: ['manufacturer details'],
  packer_details: ['packer details'],
  shelf_life_months: ['shelf life'],
  stock: ['stock'],
  minimum_order_quantity: ['minimum order quantity (minoq)'],
  shipping_provider: ['shipping provider'],
  luxury_cess: ['luxury cess'],
  tea_form: ['tea form'],
  quantity: ['quantity'],
  quantity_unit: ['quantity unit'],
  type: ['type'],
  container_type: ['container type'],
  pack_of: ['pack of'],
  maximum_shelf_life: ['maximum shelf life'],
  maximum_shelf_life_unit: ['maximum shelf life unit'],
};

const REQUESTED_DEFAULTS = {
  stock: '100',
  minimum_order_quantity: '1',
  shipping_provider: 'Flipkart',
  luxury_cess: '0',
};

// All five prior Tea listings are 25 g, pack 1, Herbal Tea with 24 months'
// shelf life; four of five use Plastic Bottle. Leaves is the closest form
// option represented by the existing leaf/flower/stem Tea SKUs.
const PRODUCT_DEFAULTS = {
  tea: {
    tea_form: 'Leaves',
    quantity: '25',
    quantity_unit: 'g',
    type: 'Herbal Tea',
    container_type: 'Plastic Bottle',
    pack_of: '1',
    maximum_shelf_life: '24',
    maximum_shelf_life_unit: 'Months',
  },
};

const SKU_RX = /^[A-Z]{2,15}_P[1-9]\d*_[1-9]\d*(?:G|KG|ML|L)$/;

function addGeneratedSku(drafted, value) {
  const field = state.formFields.find((f) => nkey(f.label) === 'seller sku id');
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const parts = raw.match(/P([1-9]\d*)[_-]([1-9]\d*)(KG|ML|G|L)$/);
  const prefix = parts ? raw.slice(0, parts.index).replace(/[^A-Z]/g, '') : '';
  const sku = parts && prefix.length >= 2 && prefix.length <= 15
    ? `${prefix}_P${parts[1]}_${parts[2]}${parts[3]}` : raw;
  if (!field || !SKU_RX.test(sku)) return drafted;
  const existing = drafted.find((f) => !f.otherTab && nkey(f.label) === 'seller sku id');
  if (existing) {
    existing.value = sku;
    existing.confidence = 'medium';
    existing.source = 'generated from label and prior SKU format';
  } else {
    drafted.push({ label: field.label, value: sku, confidence: 'medium',
      source: 'generated from label and prior SKU format' });
  }
  return drafted;
}

function addUsageInstructions(drafted, value) {
  const field = state.formFields.find((f) => nkey(f.label) === 'usage instructions');
  const text = String(value || '').trim();
  if (!field || !text || nkey(text) === 'none') return drafted;
  const existing = drafted.find((f) => !f.otherTab && nkey(f.label) === 'usage instructions');
  if (existing) {
    existing.value = text;
  } else {
    drafted.push({ label: field.label, value: text, confidence: 'medium',
      source: 'label-derived or inferred from product type' });
  }
  return drafted;
}

function normaliseDraftValue(field) {
  if (nkey(field.label) !== 'weight') return field;
  const match = String(field.value).trim().match(/^(\d+(?:\.\d+)?)\s*(g|kg)?$/i);
  if (!match) return field;
  const amount = Number(match[1]);
  if (match[2]?.toLowerCase() !== 'g' && amount < 50) return field;
  return { ...field, value: String(amount / 1000), confidence: 'medium',
    source: `${field.source}; converted grams to kg` };
}

function addMissingDefaults(drafted, category) {
  const categoryDefaults = state.seed.categories[category]?.defaults || {};
  const productDefaults = PRODUCT_DEFAULTS[category] || {};
  const defaults = { ...categoryDefaults, ...productDefaults, ...REQUESTED_DEFAULTS };
  const present = new Set(drafted.filter((f) => !f.otherTab).map((f) => nkey(f.label)));
  for (const [key, value] of Object.entries(defaults)) {
    const aliases = DEFAULT_LABELS[key];
    if (!aliases) continue;
    const field = state.formFields.find((f) => aliases.includes(nkey(f.label)));
    if (!field) continue;
    const existing = drafted.find((f) => !f.otherTab && nkey(f.label) === nkey(field.label));
    if (existing && key in REQUESTED_DEFAULTS) {
      existing.value = String(value);
      existing.confidence = 'medium';
      existing.source = 'requested default';
      continue;
    }
    if (present.has(nkey(field.label))) continue;
    drafted.push({ label: field.label, value: String(value), confidence: 'medium',
      source: key in REQUESTED_DEFAULTS ? 'requested default' :
        key in productDefaults ? 'previous listing default' : 'house default' });
    present.add(nkey(field.label));
  }
  return drafted;
}

function addFirstDropdownDefaults(drafted) {
  const present = new Set(drafted.filter((f) => !f.otherTab).map((f) => nkey(f.label)));
  for (const field of state.formFields) {
    if (field.kind !== 'dropdown' || present.has(nkey(field.label))) continue;
    const current = String(field.current || '').trim();
    const allowed = allowedFor(field.label) || [];
    const value = allowed.find((option) => nkey(current).includes(nkey(option))) ||
      allowed.find((option) => !/^select(?: one)?$/i.test(option.trim())) ||
      (!/^select(?: one)?$|^\d+ selected$/i.test(current) ? current : '');
    if (!value) continue;
    drafted.push({ label: field.label, value, confidence: 'low',
      source: 'first allowed option — review' });
    present.add(nkey(field.label));
  }
  return drafted;
}

/* ---------- label snapping --------------------------------------------
 * Gemini sometimes returns a near-miss label ("FSSAI License Number" for the
 * form's "FSSAI Number"). Snap it onto a real scanned label when the match is
 * unambiguous, and say so, rather than failing at insert time.            */
const tokens = (s) => new Set(nkey(s).split(' ').filter((t) => t.length > 2));

function snapLabel(label) {
  const want = nkey(label);
  const exact = state.formFields.find((f) => nkey(f.label) === want);
  if (exact) return { label: exact.label };

  const a = tokens(label);
  const scored = state.formFields.map((f) => {
    const b = tokens(f.label);
    const shared = [...a].filter((t) => b.has(t)).length;
    const contained = shared === Math.min(a.size, b.size) && shared > 0;
    return { f, shared, contained };
  }).filter((x) => x.contained).sort((x, y) => y.shared - x.shared);

  if (scored.length === 1 || (scored.length > 1 && scored[0].shared > scored[1].shared)) {
    return { label: scored[0].f.label, snapped: label };
  }
  return { missing: true };
}

/* ---------- analyse ---------------------------------------------------- */
$('cancelAnalyse').onclick = () => {
  if (!state.abortController) return;
  state.abortController.abort();
  setStatus('Cancelling analysis…');
};

$('analyse').onclick = async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  const model = $('model').value || (await chrome.storage.local.get('model')).model;
  if (!apiKey) { $('settings').hidden = false; return setStatus('Add your Gemini API key.'); }
  if (!model) { $('settings').hidden = false; return setStatus('Load and pick a model.'); }

  state.busy = true;
  state.abortController = new AbortController();
  refreshAnalyse();
  setStatus(`Reading ${state.images.length} photo(s) with ${model}…`);
  try {
    const category = $('category').value;
    const images = await Promise.all(state.images.map(fileToInlineData));
    const out = await extract({
      apiKey, model, images, schema: SCHEMA, prompt: buildPrompt(category),
      signal: state.abortController.signal,
    });
    state.drafted = addFirstDropdownDefaults(addMissingDefaults(addUsageInstructions(addGeneratedSku((out.fields || []).map((f) => {
      const s2 = snapLabel(f.label);
      if (s2.missing) return { ...f, otherTab: true };
      return normaliseDraftValue({ ...f, label: s2.label, snappedFrom: s2.snapped });
    }), out.seller_sku_id), out.usage_instructions), category));
    const here = state.drafted.filter((f) => !f.otherTab).length;
    const omitted = Math.max(0, state.formFields.length - here);
    render();
    setStatus(`${state.drafted.length} drafted — ${here} match fields on this tab. ` +
              (omitted ? `${omitted} scanned field(s) had no safe value and were omitted.` : ''));
  } catch (e) {
    setStatus(e.name === 'AbortError' ? 'Analysis cancelled.' : e.message);
  } finally {
    state.abortController = null;
    state.busy = false;
    refreshAnalyse();
  }
};

/* ---------- render ----------------------------------------------------- */
function render() {
  $('results').hidden = state.drafted.length === 0;
  const box = $('fields');
  box.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'groupHdr';
  const all = document.createElement('button');
  all.className = 'secondary';
  all.textContent = 'Insert all';
  all.onclick = () =>
    insertMany(state.drafted.map((_, i) => i).filter((i) => !state.drafted[i].otherTab));
  const here = state.drafted.filter((f) => !f.otherTab).length;
  const omitted = Math.max(0, state.formFields.length - here);
  hdr.append(document.createTextNode(
    `${here} ready${omitted ? ` · ${omitted} unknown omitted` : ''}` +
    (here < state.drafted.length ? ` · ${state.drafted.length - here} elsewhere` : '')), all);
  box.append(hdr);

  state.drafted.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'field' + (f.otherTab ? ' otherTab' : '');
    el.innerHTML = `
      <div class="top">
        <span class="lbl"></span>
        <span class="badge ${f.confidence}">${f.confidence}</span>
      </div>
      <textarea class="val" rows="1"></textarea>
      <div class="snapnote"></div>
      <div class="acts">
        <button data-a="ins">Insert</button>
        <button data-a="copy" class="secondary">Copy</button>
        <span class="src hint"></span>
      </div>
      <div class="msg"></div>`;
    el.querySelector('.lbl').textContent = f.label;
    el.querySelector('.val').value = f.value;
    el.querySelector('.src').textContent = f.source;
    const note = el.querySelector('.snapnote');
    if (f.otherTab) {
      note.textContent = 'Not a field on this tab — switch tab in Seller Hub and rescan.';
      el.querySelector('[data-a=ins]').disabled = true;
    } else if (f.snappedFrom) {
      note.textContent = `Gemini called this "${f.snappedFrom}" — matched to the form's label.`;
    }
    el.querySelector('[data-a=ins]').onclick = () => insertMany([i]);
    el.querySelector('[data-a=copy]').onclick = async () => {
      await navigator.clipboard.writeText(el.querySelector('.val').value);
      msg(i, true, 'Copied — paste it into the form.');
    };
    el.querySelector('.val').oninput = (e) => { state.drafted[i].value = e.target.value; };
    box.append(el);
  });
}

function msg(i, ok, text) {
  const n = $('fields').querySelectorAll('.field')[i]?.querySelector('.msg');
  if (n) { n.className = `msg ${ok ? 'ok' : 'err'}`; n.textContent = text; }
}

const ALIASES = { in: 'India', ind: 'India', india: 'India' };

function validate(f) {
  const opts = allowedFor(f.label);
  if (!opts) return null;
  const alias = ALIASES[nkey(f.value)];
  if (alias && opts.some((o) => nkey(o) === nkey(alias))) return alias;
  const hit = opts.find((o) => nkey(o) === nkey(f.value));
  if (hit) return hit === f.value ? null : hit;      // normalise casing
  return { bad: `"${f.value}" is not an allowed value for ${f.label}.` };
}

async function insertMany(idxs) {
  // Refuse to push a value the form is guaranteed to reject.
  const blocked = [];
  for (const i of idxs) {
    const v = validate(state.drafted[i]);
    if (v && v.bad) { msg(i, false, v.bad); blocked.push(i); }
    else if (typeof v === 'string') { state.drafted[i].value = v; render(); }
  }
  idxs = idxs.filter((i) => !blocked.includes(i));
  if (!idxs.length) return setStatus('Nothing inserted - all values failed validation.');
  setStatus(`Inserting ${idxs.length} field(s)…`);
  const r = await toPage({
    action: 'FILL_MANY',
    fields: idxs.map((i) => ({ label: state.drafted[i].label, value: state.drafted[i].value })),
  });
  if (!r.ok) return setStatus(r.error);
  let ok = 0;
  r.results.forEach((res, k) => {
    msg(idxs[k], res.ok, res.ok ? 'Inserted.' : res.reason);
    if (res.ok) ok++;
  });
  setStatus(`${ok}/${r.results.length} inserted. Anything that failed, use Copy and paste it.`);
}

/* ---------- bulk-sheet row -------------------------------------------- */
$('copyRow').onclick = async () => {
  const header = state.drafted.map((f) => f.label).join('\t');
  const values = state.drafted.map((f) => String(f.value).replace(/\t|\n/g, ' ')).join('\t');
  await navigator.clipboard.writeText(`${header}\n${values}`);
  setStatus('Copied header + row. Paste into the bulk catalogue sheet.');
};

/* ---------- boot ------------------------------------------------------- */
(async () => { await loadSeed(); await loadSettings(); refreshAnalyse(); })();
