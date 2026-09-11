# GoProVeda Listing Assistant

A Chrome side-panel extension that reads product-label photos with Gemini and
drafts Flipkart Seller Hub or Meesho Supplier listing fields for review.

## Safety contract

This is the part that keeps the seller account out of trouble. Do not weaken it.

- **It never submits.** The extension fills form fields only. It never clicks
  *Send to QC*, *Submit Catalog*, *Save* or any navigation control. You do that.
- **It never scrapes.** It reads the labels of the form that is already open in
  front of you. It does not walk your listings, page through results, or fetch
  anything from either marketplace.
- **It makes zero Flipkart API calls.** Nothing here touches `api.flipkart.net`,
  so nothing here spends the 1,000 requests/hour that the whole seller account
  shares. See `../CLAUDE.md` §3.
- **One listing at a time, driven by your clicks.** No batch runs, no headless
  automation, no background timers.
- **Only product data leaves the browser.** Label photos and your own listing
  patterns go to Gemini. Order data, buyer data and Flipkart credentials never do
  — the API Licence Agreement Exhibit A §5.1 requires that, so keep it that way.
- **It holds no Flipkart credentials.** It rides the Seller Hub session you are
  already logged into and stores nothing about it.

## Install

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick
   this `extension/` folder.
2. Open a Flipkart Seller Hub or Meesho Supplier listing form, then click the
   extension icon to open the side panel.
3. Click ⚙, paste your **Gemini API key**, hit **Load models**, pick one
   (`gemini-2.5-flash` is a good default), then **Save**.

Get a key at <https://aistudio.google.com/apikey>. It is stored in
`chrome.storage.local` — this browser profile only. It is never written to disk
in this repo and never sent to Flipkart.

## Use

1. **Category** — pick `edible_seed`, `hair_treatment` or `tea`. House defaults
   for that category come from your own 46 listings.
2. **Label photos** — front, back, nutrition panel, FSSAI number. The clearer the
   packaging text, the better the extraction.
3. **Scan form fields** — with the marketplace listing form open. The extension
   reads the *actual* labels on screen. Switch tabs and rescan when a form uses
   tabbed sections; Meesho's single-page form is scanned at once.
4. **Analyse photos** — Gemini drafts values for the scanned labels.
5. **Review, then insert.** Every value is editable before it goes in. Insert one
   field or all of them. Anything that fails to insert, use **Copy** and paste it
   by hand.

**Copy as row** puts a header + tab-separated row on the clipboard for pasting
into the bulk catalogue sheet.

## Why it might not fill a field

The marketplace forms use generated class names, so the extension matches
fields by their **visible label text**, never by CSS class. That survives most
redeploys, but not all. When a field cannot be filled you get a reason, not a
silent failure:

| Message | Meaning |
|---|---|
| *Field not found on this page/tab* | Wrong tab open, or Flipkart renamed the label |
| *matches N fields here* | Ambiguous label — fill that one by hand |
| *Value did not stick* | React rejected it (bad format, or a validation rule) |
| *Could not find the option* | Dropdown wording differs — pick it manually |
| *Could not establish connection* | The page had no content script. The extension now injects one automatically; if it still fails, reload the Seller Hub tab. |
| *Switch to the Flipkart Seller Hub or Meesho Supplier tab* | Some other tab is active. The listing tab must be focused when you click Scan. |

Custom dropdowns are the most fragile part. Plain text inputs are reliable.

## Refreshing the seed

When your catalogue changes, re-export from **Listings → All Listings →
Downloads** (a UI export, which costs no API quota) and rebuild:

```bash
pip install xlrd
python3 tools/build_seed.py <listing-export.xls> [catalog-template.xls ...]
```

Passing a catalogue template too (e.g. the `C_tea_*.xls` bulk template) records
its 95-column schema and dropdown option lists into the seed.

## What the seed currently knows

- 46 listings across `edible_seed` (23), `hair_treatment` (18), `tea` (5)
- 17 product abbreviations already in use, so it reuses rather than invents
- Per-category defaults for HSN, tax code, package size, fees, metrology
- The `tea` bulk catalogue schema: 95 columns + dropdown values
- 7 data issues found in the existing catalogue (shown in the panel)

## Known limits

- **Images stay manual.** The extension cannot upload photos into the form, and
  AI must never generate product images — Flipkart requires authentic photos and
  will fail QC. (The bulk catalogue sheet does accept public image URLs, which is
  a separate path worth considering.)
- **Only `tea` has a parsed catalogue template.** Download the `edible_seed` and
  `hair_treatment` templates and re-run `build_seed.py` to add them.
- **Meesho dropdown options are discovered when opened.** If Gemini cannot infer
  one, the assistant offers the first available option at low confidence for
  review; GST and HSN are never given arbitrary first-option fallbacks.
- **Gemini transcribes; it does not verify.** Always check FSSAI number, net
  weight, dates and manufacturer details against the physical pack. Wrong legal
  metrology data on a live listing is a compliance problem, not a typo.
