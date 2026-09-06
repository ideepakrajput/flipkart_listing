# CONTEXT.md — GoProVeda Listing Assistant (handoff)

Read this before changing anything. It records what the extension does, what is
known-good, what is still guesswork, and the failure modes that already cost
several wasted iterations.

**Repo:** `flipkart_listing/extension/`
**Related:** `../CLAUDE.md` — Flipkart Seller API limits, licence terms and
account-safety rules. Read §0, §3 and §7 before touching anything network-facing.

---

## 1. What this is

A Chrome MV3 side-panel extension for a single Flipkart seller (GOPROVEDA,
brand *Promishor*). It reads product-label photographs with Gemini and drafts
values for the Flipkart Seller Hub "Add a Single Listing" form, which the user
reviews and inserts field by field.

It exists because Flipkart's **Listing API cannot create products** — it needs an
existing FSN, has no image upload, and no product/catalogue fields. Roughly 21 of
the form's ~76 fields are API-addressable; the rest are UI-only. See
`../CLAUDE.md` §6a and §6b.

---

## 2. Safety contract — do not weaken

These are not stylistic preferences. Violating them risks the seller's live
account (`../CLAUDE.md` §7 lists the documented penalties).

1. **Never submit.** No clicking *Send to QC*, *Save*, *Submit*, or navigating.
   Filling form fields is the entire remit.
2. **Never scrape.** Read only the form already on screen. No walking listings,
   no pagination, no background fetching from Flipkart.
3. **Zero Flipkart API calls.** Nothing here touches `api.flipkart.net`. The
   whole seller account shares 1,000 requests/hour; this must spend none of it.
   Catalogue data comes from **UI exports** (`Listings → All Listings →
   Downloads`), never from the API.
4. **User-initiated only.** One listing at a time, each action on a click. No
   batch loops, no timers, no headless runs.
5. **Product data only leaves the browser.** Label photos + the seller's own
   listing patterns go to Gemini. Order data, buyer data and Flipkart
   credentials never do (Licence Agreement Exhibit A §5.1).
6. **No Flipkart credentials.** The extension rides the existing logged-in
   session and stores nothing about it. The Gemini key lives in
   `chrome.storage.local` only — never in source, never committed.

---

## 3. Architecture

```
manifest.json          MV3. sidePanel + storage + activeTab + scripting.
                       Hosts: seller.flipkart.com, generativelanguage.googleapis.com

background.js  (52)    Service worker. Relays panel -> content script.
                       ensureInjected() injects filler.js on demand, because the
                       content script is only auto-injected into pages loaded
                       AFTER install - an already-open Seller Hub tab has no
                       listener ("Receiving end does not exist").

panel/panel.{html,css,js}  (406)  The side-panel UI and all orchestration:
                       settings, seed loading, image upload, prompt building,
                       Gemini call, label snapping, validation, render, insert.

content/filler.js (413)  Runs in the page. Finds form fields and writes values.
                       This is the fragile half - see §5.

lib/gemini.js  (68)    Gemini REST client. listModels / extract / fileToInlineData.
                       Uses responseSchema for structured JSON, temperature 0.2.

seed/patterns.json     Generated. Never hand-edit.
tools/build_seed.py (239)  Regenerates it from Seller Hub .xls exports.
```

**Message flow:** panel → `chrome.runtime.sendMessage({type:'RELAY_TO_PAGE'})` →
background → `chrome.tabs.sendMessage` → filler. Actions: `PING`, `SCAN`,
`FILL_ONE`, `FILL_MANY`, `DUMP`.

---

## 4. The seed

`seed/patterns.json` is built from two workbooks the seller downloads:

| Source | Gives |
|---|---|
| `S_listing--ui--group_*.xls` (All Listings → Downloads) | 46 live listings: SKUs, titles, per-category defaults, data-quality audit |
| `C_tea_*.xls` (bulk catalogue template) | 95-column schema, help text, and **the Index sheet's dropdown option lists** |

Rebuild:
```bash
pip install xlrd
python3 tools/build_seed.py <listing-export.xls> [catalog-template.xls ...]
```

Contents: `sku_convention`, `abbrev_to_products` (17 in use),
`categories` (per-category defaults + an `inconsistent` map),
`title_examples`, `data_issues`, `ui_dropdowns`, `catalog_templates`.

**The Index sheet is the good source of dropdown values** — richer than the
`DropDownValuesForColumn*` sheets, which are partial and include a stray list
keyed to a numeric column. `build_seed.py` merges Index, drops dropdowns whose
column type is numeric/date/url, and de-duplicates.

Only `tea` has a parsed catalogue template. Download the `edible_seed` and
`hair_treatment` templates and re-run to add them.

### Known data issues in the live catalogue (surfaced in the panel)
- 4 tea listings have the raw SKU inside the product title (Model Name)
- `ROPTSFLT_PP1_25G`, `BS_01_250` break the SKU convention; `WAMESD_P1_ 200G`
  contains a space
- `edible_seed` HSN is split `08029000` (14) vs `12079990` (9) — a possible GST
  misclassification. **Flagged, not fixed. Do not "correct" it in code.**

---

## 5. Field detection — the hard part

Flipkart's form is **React with minified, deploy-unstable class names**. Never
match on class names. Two stages:

### Stage 1 — find controls (`controls()`, filler.js:110)
- **Native:** `input` (not hidden/file/checkbox/radio), `textarea`, `select`,
  `[role=combobox]`. Reliable.
- **Custom dropdowns:** Flipkart renders these as plain `<div>`s. `looksLikeDropdown()`
  (filler.js:65) is a **heuristic**: no nested input/button/anchor, a visible
  border, an icon in the right 40% of the box, 28–62px tall, ≥110px wide, short
  single-line text.
- Filtered by `visible()`, `isInPopup()`, `isChrome()` (drops the Seller Hub
  header search box).
- Cached per tick; call `invalidate()` after any DOM mutation.

### Stage 2 — label each control (`labelScored()`, filler.js:168)
**Geometric, not structural.** The label is the visible text whose row
**vertically overlaps** the control and whose right edge is **left of** it,
nearest wins (gap < 420px). Fallback: text directly above, horizontally
overlapping, within 60px. `aria-label` and `<label for>` are tried first.

### Stage 3 — one label, one control (`fieldMap()`, filler.js:220)
All candidates sorted by label distance; each label claimed by its **closest**
control. A second control on the same row is either renamed (`"Quantity unit"`
for a unit picker) or dropped. This makes wrong-box writes structurally
impossible.

### Writing values (`fillOne()`, filler.js:343)
- **Text:** React installs its own `value` setter on the element instance, so
  `el.value = x` is invisible to it — the field looks filled but submits empty.
  Use `setNativeValue()`: the *prototype* setter, then `input` + `change` events.
  Every write is verified by reading the value back.
- **Dropdown:** click the div, wait, type into the panel's search box to filter,
  click the exact option. Failures report the options actually seen.
- **Date:** `<input type=date>` needs `yyyy-mm-dd` regardless of display format.

---

## 6. What has already been tried and failed

Do not reintroduce these. Each cost an iteration.

| Approach | Why it failed |
|---|---|
| Label = text of the control's DOM container | An open dropdown's option list is inside that container. Labels came back as `searchsearchcheckselect onecheckseller`. |
| Label = nearest preceding text in document order (TreeWalker) | Flipkart's nesting doesn't put label text where the walk expects. 22 of 27 controls got no label; survivors were the header search box (`Rate Card`) and dropdown placeholders (`Select`). |
| "Field row" = ancestor containing exactly one control | Coupled to the dropdown heuristic. When detection got noisier, row-finding collapsed entirely: 27 controls → 2 fields. |
| `isInPopup`: any positioned ancestor containing a `[role=option]` | Flipkart keeps closed dropdowns' options in the DOM inside the form container, so the **whole form** matched and every field was excluded. Now also requires ≤2 inputs in that container. |
| Dropdown = div with an svg + short text | Every label cell is `Label ⓘ` — an svg with short text. Label cells and section headings (`Price Details`, `Tax Details`) were detected as dropdowns, giving 52 controls for ~23 fields and `x2` on every label. Fixed by requiring a border and a right-aligned icon. |
| Fuzzy prefix matching label → control | Put a value into the wrong field (`Luxury Cess = 5`). Matching is now exact against `fieldMap`. |

**Method note:** the repeated failure mode was inferring DOM structure from
screenshots and patching heuristics on top of heuristics. The geometric approach
works because screen layout *was* observable. If Stage 1 needs more work, get the
real markup first — the panel's **Copy form HTML** button (`DUMP` action) copies
the outerHTML of the first 12 detected controls.

---

## 7. Current state

**Working:** control discovery, geometric labelling (35 correctly-named fields
found on the Price/Stock tab), Gemini extraction (reads FSSAI numbers,
ingredients, manufacturer addresses off label photos at high confidence), text
insertion, validation against allowed values, label snapping
(`"FSSAI License Number"` → the form's `"FSSAI Number"`), country alias
(`IN` → `India`), other-tab detection.

**Unverified / suspect:**
- The one-to-one `fieldMap()` and tightened `looksLikeDropdown()` are the newest
  changes and have **not been confirmed against the live form**.
- **Dropdown setting is the weakest link.** A recent run reported
  `No option "GST_5". Saw: FSN New Customer` — it had opened the wrong element.
  `popupRoot()` / `optionsIn()` (filler.js:258, 280) are heuristic and may be
  finding the header search suggestions instead of the dropdown menu.
- `rowFor()` (filler.js:127) is now used only by `DUMP`.

**Out of scope, permanently:** image upload (the extension cannot, and AI must
never generate product images — Flipkart requires authentic photos and will fail
QC). The bulk catalogue sheet does accept public image URLs; that is a separate
path.

---

## 8. Testing

There is no automated test — it needs a live Seller Hub session.

Syntax check:
```bash
node -e "new Function(require('fs').readFileSync('content/filler.js','utf8'))"
node --check background.js
python3 -c "import json;json.load(open('manifest.json'));json.load(open('seed/patterns.json'))"
```

Manual loop: `chrome://extensions` → reload the extension → **reload the Seller
Hub tab** (a stale content script keeps running otherwise) → open the panel →
Scan → compare the "Fields found on this tab" list against what is on screen.

Success on the Price/Stock tab looks like ~23 fields from ~25 controls, no
duplicate badges, no section headings (`Price Details`, `Tax Details`) in the
list.

---

## 9. House facts

- Brand is exactly **Promishor**. Never append product words (Flipkart's own
  brand-violation guidance: `Nike`, not `Nike Shoes`).
- SKU: `{ABBREV}{FORM}_P{packOf}_{quantity}{UNIT}`, `SD`=Seed, `PD`=Powder,
  `FLT`=Flower Tea, `LVT`=Leaf Tea. **The abbreviation is not algorithmic** —
  2–8 hand-made chars. Reuse from `abbrev_to_products`; only coin one for a
  genuinely new product.
- Titles are **generated by Flipkart** from attributes ("Re-generate Title").
  Never write titles; fill the attributes that produce one.
- Multi-value fields separate with `::`.
- Stock minimum 5 for listing visibility; max 5,000 per location.
- Images: ≥1100×1100 (the UI figure; the template says 100×500 — use the
  stricter), JPEG, RGB, Front View mandatory and first.
- The `Product Description` field set is **vertical-specific** — `Tea Form` is a
  Tea field. There is no universal template; one per vertical.
- Gemini transcribes, it does not verify. FSSAI number, net weight, dates and
  manufacturer details must be checked against the physical pack — wrong legal
  metrology data on a live listing is a compliance problem, not a typo.
