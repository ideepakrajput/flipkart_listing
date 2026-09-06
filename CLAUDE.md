# Flipkart Seller API — Operating Rules for This Project

**Purpose of this file:** Deepak's Flipkart seller account (GOPROVEDA) must not get throttled,
suspended, or deactivated. Everything below is sourced from Flipkart's own docs and the signed
API Licence Agreement. Read this file **before** writing or running any code that touches
`api.flipkart.net`.

Last verified against live docs: **2026-09-05**.

---

## 0. Hard rules (non-negotiable)

1. **Never call a Flipkart API without explicitly telling Deepak first and getting a yes.**
   Not "I'll just test one call." Every call is counted against a 1000/hour budget tied to the
   *seller account*, not to a throwaway dev key.
2. **Never run a loop, retry storm, or "let me just enumerate everything" script.** Aggressive
   polling is named in the Licence Agreement as abuse (Exhibit B §2).
3. **Never share, paste, commit, or send the App ID / App Secret anywhere** — including to a
   third-party tool, an aggregator, or a hosted service. Doc: *"Do not share the self access
   application details with any 3rd party partner(s) / aggregator... Violations will lead to
   seller account deactivation."*
4. **Read the relevant doc page before hitting a new endpoint.** Docs are mirrored locally per
   §9 — read the mirror, not the live site, to avoid needless traffic.
5. **Write mutations (create listing, update price, update inventory, dispatch, cancel) require
   a separate explicit confirmation each time.** These change what real customers see and what
   real money is charged.
6. **Never cancel orders programmatically as a "cleanup" step.** Cancellations above a threshold
   deactivate the seller account/location (see §7).

---

## 1. Current account state

| Field | Value |
|---|---|
| Seller | GOPROVEDA |
| Access type | **Self Access** (Client Credentials flow) — *not* a Partner/Third-Party app |
| Access name | Web App ("Web App to manage Listing") |
| Website Domain registered | `ideepakrajput.in` |
| Created | 2026-09-05 |
| Expiry | Never |
| **Status** | **`Pending`** |

### ⚠️ Two things to fix before any code runs

**(a) The app status is `Pending`, not Active.**
Token generation and API calls will most likely fail (401/403) until Flipkart flips it to
approved. Do **not** interpret an auth failure as "wrong code" and start retrying with variations
— that is exactly the pattern that looks like credential-stuffing. If the first token call fails,
**stop** and raise a ticket via Seller Dashboard → *API GA* node.

**(b) The App ID and App Secret are sitting in plaintext in `doc.md`.**
`doc.md` lines 1 and 3 contain the live API Key and Secret. Per the Licence Agreement
(Exhibit A §5.1), OAuth tokens and credentials must be kept confidential and never exposed.

Action required:
- Move both values into a `.env` file (or macOS Keychain) that is **git-ignored**.
- Strip them from `doc.md`.
- If this folder was ever pushed anywhere, **regenerate the secret** in Seller Hub.
- Code reads them as `FK_APP_ID` / `FK_APP_SECRET` from env. Never hardcode.

---

## 2. Why Flipkart asked for a Website Domain

This is the question that matters most for not getting flagged, so here is what is actually
documented vs. what is inference.

**Documented facts:**
- The Response Codes page states: *"Client (4xx): Authentication failure **or invalid domain on
  the client side**"* — so the domain you register is part of what Flipkart validates a request
  against.
- Exhibit A §1 (API Security Standards): access is only granted to *"user(s) who are either
  seller(s) with valid seller credentials or partner(s) with valid partner credentials"* — i.e.
  the app must be attributable to a real, identifiable operator.
- §5.1 of the Agreement: *"Distribute, publish, or allow access or linking to the API or Flipkart
  Content from any location or source other than **your Application**."* Flipkart Content may only
  be surfaced inside the application you declared.
- Exhibit A §2.1: Flipkart *"reserves the right to periodically audit your Systems"* and may run
  *"non-intrusive network and application security scans... randomly without prior notice."*
- For Third-Party apps the docs require a `Redirect URL` that *"has to be strictly a valid https
  link"*, registered up front.

**What this means in practice (inference, but well-supported by the above):**
The Website Domain is Flipkart's **accountability + anti-sharing anchor**. It ties your API
credentials to a web property you demonstrably own, so that:
1. Flipkart can verify a self-access seller is genuinely self-serving and not quietly reselling
   the credentials to an aggregator (the thing they threaten deactivation over).
2. They have a scannable, auditable endpoint for the random security scans in Exhibit A §2.1.
3. Flipkart Content (listings, order data) is confined to that declared application/domain.
4. It gives them a contact/enforcement surface if something goes wrong.

**Therefore, for `ideepakrajput.in`:**
- Keep the domain live, HTTPS-only, and resolving. A dead domain during an audit is a bad look.
- Any UI that renders Flipkart order/listing data should live on that domain, not on some random
  host.
- If the app moves to a different domain, **update it in Seller Hub first**. Don't just move it.
- **All API calls must be HTTPS.** *"HTTP requests are not supported."*

---

## 3. THE RATE LIMIT — Exhibit B of the Licence Agreement

This is the only place Flipkart publishes real numbers. It is **not** in the HTML docs; it is in
the API Licence Agreement PDF. Memorize it.

| Persona | Counted per | Max per **rolling hour** | Max per **rolling 24h** |
|---|---|---|---|
| **Seller** ← *this is us* | **Seller ID** | **1,000** | Not Applicable |
| Partner | Partner ID | 1,000 | 300,000 |

**Critical implications:**
- The limit is **per Seller ID**, not per app. It is a **shared** budget. The Flipkart Seller Hub
  UI, any other tool, and our scripts all draw from the same 1,000/hour.
- **Rolling window**, not a fixed clock hour. Burning 1,000 calls at 2:05pm does not reset at
  3:00pm — it frees up gradually from 3:05pm.
- 1,000/hour ≈ **16 calls/minute** ≈ **1 call every 3.6 seconds** as a sustained average.
- **Push notifications from Flipkart to us are excluded** from the rate limit. This is the single
  biggest argument for using the Notification Service over polling (see §5).

### Abuse rate limits (Exhibit B §2) — the part that actually gets accounts flagged
> *"To protect Flipkart's quality of service, **additional Rate Limits may apply** to some actions
> or during certain sale days when additional traffic is anticipated. For example, rapidly
> creating content, **polling aggressively**, making API calls with **high concurrency**, or
> repeatedly requesting data that is **computationally expensive** may result in abuse of Rate
> Limits."*

So the 1,000/hour is a ceiling, **not a target**. Undocumented tighter limits can kick in during
Big Billion Days / sale events. And §5.11 of the Agreement prohibits *"use of the API in a manner
that exceeds reasonable request volume, constitutes excessive or abusive usage."*

### Self-imposed budget for this project

| Phase | Cap | Rationale |
|---|---|---|
| Development / debugging | **≤ 60 calls/hour** (6% of budget) | Leaves the account fully functional |
| Normal automated operation | **≤ 200 calls/hour** (20%) | Wide headroom for Seller Hub + sale-day tightening |
| Absolute ceiling, ever | **500 calls/hour** (50%) | Never approach the real limit |
| Concurrency | **1** in-flight request. No parallelism. | Exhibit B §2 names high concurrency as abuse |
| Min gap between calls | **≥ 2 seconds** | Sustained-rate discipline |

Implement a token-bucket/leaky-bucket limiter in the client. Do not rely on `sleep()` sprinkled
in by hand.

---

## 4. Authentication

**Self Access = Client Credentials flow.** (Authorization Code flow is for partners/aggregators
only — *"Any volition will lead to permanent ban on Flipkart."* Do not use it.)

```
GET https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api
Authorization: Basic base64(<appId>:<appSecret>)
```

Response: `{ "access_token": "...", "token_type": "bearer", "expires_in": <seconds>, "scope": "Seller_Api" }`

Then every API call:
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Token rules
- **Access token validity: ~60 days.** Docs: *"Do not hard-code the Access Token value in the
  Authorization header as the token expires after some time - usually, 60 days."*
- **Refresh token validity: 180 days** (Authorization Code flow only; Client Credentials returns
  no refresh token).
- An expired token yields **401**. On 401: regenerate **once**, retry **once**, then stop.
- **Cache the access token on disk.** Do not call the token endpoint on every run — that wastes
  the shared budget and looks like credential churn.
- Check remaining validity cheaply instead of guessing:
  ```
  GET /oauth-service/oauth/token/expiry?token_type=access&token=<token>
  Authorization: Basic base64(<appId>:<appSecret>)
  → { "expired": false, "token_type": "access_token", "expires_in": 5183981 }
  ```
  Refresh proactively when `expires_in` drops below ~3 days.

---

## 5. Polling vs. Notifications

Flipkart explicitly offers two mechanisms:
- **Pull** — call the APIs at periodic intervals.
- **Push** — subscribe to the Order Management Notification Service.

The docs say push exists to *"improve the performance of your application by eliminating
additional network and computation costs in polling resources to determine if they have changed"*
— **and push events do not count against the rate limit.**

**Prefer push wherever possible.** Notification subscription is not self-serve; it requires a
ticket (Seller Dashboard → API GA node) plus:
- Seller ID / registered email
- HTTPS notification receiver URL (this is where `ideepakrajput.in` earns its keep)
- **VAPT certificate** for that URL, and an NDA
- Whether return notifications are needed (+ URL + its VAPT cert)
- Location IDs to listen on
- App ID and App Secret

**If we must poll**, minimum intervals:

| Data | Min interval | Note |
|---|---|---|
| New orders (`shipments/filter`) | **10 min** | Never faster. Prefer notifications. |
| Label/invoice readiness after `POST /v3/shipments/labels` | **30 s**, max ~10 polls | Docs: usually 5–10 s, occasionally up to 30 min. After 30 min, contact seller support — don't keep polling. |
| Listing/inventory reconciliation | **1× per day** | Full sweeps are expensive |
| Report status (`GET /reports/:reportId/detail`) | **60 s** | Reports are async and slow |

**Notification consumption is mandatory once subscribed.** Docs: *"Since Flipkart ensures the
ordering of the events, all the incoming events must be consumed by the client apps in order to
receive the subsequent events of the group. A failure in event consumption will lead to
non-delivery of the new events of this group."* — Always return success and no-op on events you
don't care about; never let the receiver 500.

---

## 6. Endpoints and batch limits

Base URL (production): `https://api.flipkart.net`
There is a sandbox, but **sandbox access is not automatic** — it requires a ticket via the API GA
node. Best practice #1 in the docs is *"Test your applications in the sandbox before integrating
with the production environment"*, so **request sandbox access before building anything that
writes.**

### Listing Management (v3) — the main focus of this project

| Endpoint | Purpose | Batch limit |
|---|---|---|
| `POST /listings/v3` | Create listings | **10 SKUs max** |
| `POST /listings/v3/update` | Update listings | **10 SKUs max** |
| `GET  /listings/v3/{sku-ids}` | Get listings by SKU | — |
| `POST /listings/v3/details` | Listing details | — |
| `POST /listings/v3/product/search` | Search products/listings | **20 per batch**, paginate via `batchNo` (start 0) |
| `POST /listings/v3/update/price` | Update price | **10 SKUs max** |
| `POST /listings/v3/update/inventory` | Update inventory | **10 SKUs max** |
| `POST /listings/v3/search` | List all listings (FSN + SKU) | **500 per page**, cursor via `page_id` / `next_page_id`, continue only while `has_more` is true |

FAQ confirms: *"Is there a limit on the number of FSNs that can be sent using bulk update? Yes,
you can update a maximum of 10 FSNs at a time."*

**Do the arithmetic before any bulk job.** 10 SKUs per call against a 200/hour self-imposed cap
means **~2,000 SKUs/hour maximum**. A 5,000-SKU price update is a multi-hour job that must be
chunked, rate-limited, checkpointed, and resumable. If the catalogue is large, **use Seller FTP
instead of the API** — there is a documented FTP path (`listing-api-docs/LMAPIFtp.html`) built
for bulk.

**Pagination discipline:** use `POST /listings/v3/search` (500/page) for full sweeps, not
`product/search` (20/page). 500/page is 25× cheaper in calls for the same data.

### Order Management (v3) — key endpoints
```
POST /sellers/v3/shipments/filter          # search shipments
GET  /sellers/v3/shipments?shipmentIds={}  # also ?orderItemIds= / ?orderIds=
POST /sellers/v3/shipments/labels          # async label+invoice generation
GET  /sellers/v3/shipments/{ids}/labels
GET  /sellers/v3/shipments/{ids}/invoices
POST /sellers/v3/shipments/dispatch        # mark Ready To Dispatch
POST /sellers/v3/shipments/cancel          # ⚠️ see §7
POST /sellers/v3/shipments/manifest
GET  /sellers/v3/shipments/handover/counts?locationId={}
```
Returns live under `/sellers/v2/returns/*` and `/sellers/v3/returns/*`.

**Forward order lifecycle:** `APPROVED → PACKING_IN_PROGRESS → PACKED → READY_TO_DISPATCH →
SHIPPED → DELIVERED` (or `CANCELLED`).

A shipment is only actionable when **both**: current time > `dispatchAfterDate` **and**
`hold == false`. Check both before acting; acting early just burns calls on rejections.

### Reports
`POST /reports/:reportTypeIdentifier` → `GET /reports/:reportId/detail` (poll) → download from
the returned `location` URL before it expires. States: `TRIGGERED → PROCESSING → COMPLETED /
EXPIRED / FAILED`.

> **Not available to us.** *"Reports API is accessible only via 3rd party tokens / partners"* and
> *"Both Settlement and FBF reports are a paid API service by Flipkart."* Don't build against it
> on a self-access token. Use Seller Hub → Reports, or contact `api-partner-support@flipkart.com`.

---

## 6a. Scope boundary: what the Listing API can and cannot do

**Verified 2026-09-05 against `listing-api-docs/LMAPIRef.html`.**

The Listing API is an **offer/listing API, not a catalogue API.** Its documented entities are
exactly three: *Listing*, *Package*, *Location*. There is **no Product entity.**

`POST /listings/v3` requires `product_id` as **Mandatory**, *"the product's identifier in the
Flipkart Marketplace. Length Range -> 13 to 16 characters"* — i.e. an existing **FSN**. You can
only attach an offer to a product that is already in Flipkart's catalogue.

### Doable end-to-end by API (given an FSN)
- Create / overwrite a listing for a seller SKU (`POST /listings/v3`, 10 SKUs max)
- MRP, selling price, currency (`POST /listings/v3/update/price`)
- `tax.hsn` + `tax.tax_code` (tax codes are listed on the MyListings page)
- Shipping fees: local / zonal / national
- `fulfillment_profile` (`NON_FBF|FBF_LITE|FBF|FBF_AND_FBF_LITE|FBF_AND_NON_FBF`),
  `fulfillment.dispatch_sla`, `shipping_provider` (`FLIPKART|SELLER|FLIPKART_SELLER`),
  `procurement_type` (`REGULAR|EXPRESS|INTERNATIONAL|MADE_TO_ORDER|DOMESTIC`)
- `packages[]`: name, L/B/H (cm), weight, description (max 4000), `handling.fragile`,
  `notional_value` (mandatory when the lot has multiple packages)
- `locations[]`: id, `ENABLED|DISABLED`, inventory (`POST /listings/v3/update/inventory`)
- `listing_status`: `ACTIVE|INACTIVE`
- Legal metrology: `address_label` (manufacturer / importer / packer details, ISO-alpha2
  `countries_of_origin`) and `dating_label` (`mfg_date` as Linux epoch **seconds**,
  `shelf_life` in **seconds**)
- All reads: `GET /listings/v3/{sku-ids}`, `POST /listings/v3/details`,
  `POST /listings/v3/product/search`, `POST /listings/v3/search`

### NOT possible via API — must be done in Seller Hub
- **Creating the product in the catalogue** (no endpoint exists)
- **Uploading images.** Grepped every doc page: the only image field anywhere is
  `product_image_url`, and it appears solely **inside the 200 OK response** of
  `POST /listings/v3/product/search`. Read-only. No upload endpoint, no multipart, no image
  field in any request payload.
- Product title, brand, description, vertical/category, category-specific attributes

The Seller FTP bulk path does **not** close this gap either — its first mandatory column is
*"Flipkart Serial Number — the unique product identifier for Flipkart"*, and its columns are
price/stock/shipping/metrology only. No images, no catalogue creation. Also:
*"FTP updates will not be supported for sellers selling from multiple locations."*

### Practical workflow
1. **New product** → create it in Seller Hub (Add New Listing, or the bulk catalogue template
   with **publicly hosted image URLs** — `ideepakrajput.in` can host them). Wait for the FSN.
   *Unverified: the Seller Hub bulk catalogue template's exact field list is not in the API
   docs — confirm against the real template in the account before relying on it.*
2. **Product already in catalogue** (yours, or another seller's identical item) → skip step 1,
   attach directly to the existing FSN.
3. **Everything after that** → fully automatable by API.

### No server-side validation available
The create-listing doc says *"it is recommended to call upon the validate API (**to be
announced**) prior to making this call."* That endpoint was **never shipped** (page last
updated March 2018). There is no dry-run against Flipkart's rules — **all validation must be
done locally before sending.** The doc also warns: *"The rules for listing a product in the
marketplace are subject to change, so it is recommended to handle errors explicitly."*

⚠️ `POST /listings/v3` **overwrites**: *"If the SKU already exists in the system, then this call
will overwrite the listing information associated with it."* There is no partial-create. Always
read the current listing first and diff before re-sending, or use `/update`, `/update/price`,
`/update/inventory` for targeted changes.

---

## 6b. The Seller Hub listing flow, and exactly where the API picks up

Source: Deepak's screenshots in `doc.md` / `image/doc/`, captured 2026-09-05. This is the
**ground truth** for the manual half of the work.

### The UI flow
`Listings > Add a Single Listing` → three stages: **Select Vertical → Select Brand → Add Product
Details**, then **Send to QC**.

1. **Select Vertical** — browse tree (e.g. Food & Nutrition / Beverages / Tea) or search by
   product name, brand, or Flipkart URL. GOPROVEDA's verticals so far: Tea, Hair Treatment,
   Pens, Chewing Gum, Edible Seed, Spices & Masalas, Nut & Dry Fruits.
2. **Select Brand** — type brand, click *Check Brand*. Brand in use: **Promishor**. Flipkart
   warns against brand-name violations: correct spelling, full forms (`Calvin Klein` not `CK`),
   and **no extra details** (`Nike`, not `Nike Shoes`; `Apple`, not `Apple Iphones`; `Sandisk`,
   not `Sandisk 32GB`).
3. **Add Product Details** — five tabs, see the coverage map below.

Banner on these categories: *"Products listed under this category go through special checks,
please expect a higher time for the qc process to be completed."* Nothing is instant; everything
passes QC.

### Field coverage map — ~76 fields, API covers ~21

| Tab | Fields | Covered by Listing API |
|---|---|---|
| Image addition | 13 | **0** |
| Price, Stock and Shipping Information | 23 | **~21** |
| Product Description | 11 (all mandatory) | **0** |
| Additional Description (optional) | 29 | **0** |
| Variant addition (optional) | — | **0** |

The API covers ~28% of fields — but it is **100% of the commercial/operational layer** and
**0% of the catalogue/content layer**. Validation is live in the UI (tabs show e.g.
*"13 Errors"*), so the form is its own validator; the API has none (§6a).

**Price/Stock/Shipping tab → API mapping (near-total):**
Seller SKU ID (map key) · Listing Status · MRP · Selling price · Fulfilment by
(`fulfillment_profile`) · Procurement type · Procurement SLA (`dispatch_sla`) · Stock
(`locations[].inventory`) · Shipping provider · Local/Zonal/National handling fee
(`shipping_fees`) · Package L/B/H/Weight · HSN · Tax Code · Country of Origin · Manufacturer /
Packer / Importer Details · Manufacturing date · Shelf Life.

**The two fields on that tab with NO API equivalent:**
- **Minimum Order Quantity (MinOQ)**
- **Luxury Cess**

If either matters for a listing, that listing cannot be fully driven by API.

**Product Description tab (all 11 mandatory, Tea example):** Model Name, Tea Form, Quantity(+unit),
Type, Container Type, Pack Of, Ingredients, Nutrient Content, Maximum Shelf Life, FSSAI Number,
Usage Instructions.

> ⚠️ **These 11 are vertical-specific.** "Tea Form" is a Tea field; Edible Seed and Hair Treatment
> have a different 11. **There is no universal template** — one fill-sheet per vertical is
> required.

**Additional Description tab (29, optional):** Flavor, Regional Speciality, Organic, EAN/UPC,
Description (max 5000), Key Features, Search Keywords, Key Spec, Video URL, Set of, Dietary
Preference, Gourmet, Caloric Value, No of Servings, Additives, Manufactured By, Model Number,
Manufacturing Process, Allergens Included, Fortified, Pack of, Dimensions (H/W/D/Weight, Other),
Items Included, Other Features, Certification.

### Two UI features that change the plan
- **Copy-from-SKU.** The Price/Stock/Shipping tab offers: *"Don't want to fill these attributes?
  You can copy the values from one of your old SKUs!"* with an SKU search box. For a new variant
  of an existing product this beats anything we would build. Use it.
- **"Generate Title" button.** Titles are **generated by Flipkart from the attributes**, not typed.
  Never hand-write titles — fill the attributes that produce a good one.

### Hard constraints seen in the UI
- **Images:** minimum **1100×1100 px**, clear colour, authentic photos, bright lighting. 13 slots
  (Front View **mandatory** and must be first; then Veg/Non-veg mark, FSSAI view, Nutrition, Back,
  Preparation, Lifestyle, Pack of, Side View, …). Drag to reorder.
- **Stock:** *"Minimum 5 quantity required for listing visibility."*
- **Variants:** each variant is its **own FSN**, grouped under a parent, differing by **Quantity**
  and **Pack of**. Managed only in the UI (*Add existing product as variant* / *Add a new
  variant*). Example parent `EDSHPQBCYMFEBFHH` with variants `EDSHPQBCTFTBCHWG` (200, pack 1),
  `EDSHPQBCSVZAXYBH` (150, pack 1), `EDSHPQBCHFTUFQNV` (150, pack 2).
- **FSN shape:** 16 chars; variants of one family share an 8-char prefix (`EDSHPQBC`). Consistent
  with the API's documented *"Length Range -> 13 to 16 characters"*.

### SKU naming convention (GOPROVEDA)

`{PRODUCT}{FORM}_P{packOf}_{weight}{unit}` — `SD` = Seed, `PD` = Powder.

```
FXSD_P2_200G      Flax Seed         pack 2, 200g
WAMESD_P1_150G    Watermelon Seed   pack 1, 150g
BASD_P1_200G      Basil Seed        pack 1, 200g
HIBUSPD_P1_150G   Hibiscus Powder   pack 1, 150g
MUMITIPD_P1_150G  Multani Mitti Pd  pack 1, 150g
ALPD_P1_150G      Amla Powder       pack 1, 150g
```

`P{n}` and `{weight}` map directly to the form's **Pack Of** and **Quantity** fields.

> ⚠️ **The product abbreviation is not algorithmic.** It ranges 2–6 chars (`FX`, `BA`, `AL`,
> `WAME`, `HIBUS`, `MUMITI`) with no rule derivable from 6 samples. **Do not invent SKUs** until
> the full listing export is available — get the corpus first, then match the convention.

### Division of labour
| Step | Who | API cost |
|---|---|---|
| SKU, model name, all 11 Product Description + 29 Additional Description fields, from a product image | **Claude, offline** | **0 calls** |
| Paste into form, upload 13 images, Send to QC | **Deepak, Seller Hub** | ~5 min/product |
| Price, stock, shipping, tax, dims, metrology, activate/deactivate — ongoing | **Claude, via API** | automated |

### Get the corpus without spending API budget
`Listings > All Listings` has a **Downloads** button. Account holds **46 Active / 0 Ready for
Activation / 0 Blocked / 8 Inactive / 25 Archived**. Export via the UI — it costs **zero API
calls** against the 1,000/hour budget. **Always prefer a UI export over an API sweep** for
one-off analysis.

Also unexamined and worth checking: the **Add Listing** dropdown and the **Uploads** button —
if a bulk catalogue template exists, generating that file offline beats filling the form. Its
field list is unknown; do not assume it.

---

## 7. Ways to get the account restricted (avoid all of these)

| Action | Documented consequence |
|---|---|
| Sharing self-access credentials with a partner/aggregator | **Seller account deactivation** |
| Using a Third-Party app while acting as a partner without registering | **Permanent ban on Flipkart** |
| Exceeding 1,000 req/hour, or aggressive polling / high concurrency | Abuse rate limits; Flipkart may *"at its sole discretion, terminate your access to the API"* |
| Exceeding "reasonable request volume" (§5.11) | Material breach |
| Scraping / robots / spiders to get data beyond what the API returns (§5.9) | Material breach |
| Storing Flipkart Content beyond intermediate purposes (§5.4) | Material breach |
| Storing buyer login IDs, passwords, card numbers, financial info, PAN/DL/ID numbers (Exhibit A §5.1) | Immediate termination |
| **Too many order cancellations** | *"seller account/location will be deactivated for some duration of time i.e. seller will not be allowed to sell on Flipkart"* |
| Failing a security audit and not fixing within 30 days | Suspension/termination without notice |
| Not reporting a security breach within 24h (max 2 days) to `seller-api-queries@flipkart.com` | Breach of Exhibit A §3.1 |

Flipkart also reserves the right to **monitor and audit**, including *"technical means to overcome
any methods you may use to block or interfere with such monitoring"* — so no cloaking, no
user-agent games, no proxy rotation. Ever.

---

## 8. Client implementation checklist

Any Flipkart client written in this repo must have:

- [ ] Credentials read from env / Keychain — **never** in source or in `doc.md`
- [ ] Token cached to disk with expiry; proactive refresh at < 3 days remaining
- [ ] Single-flight: **concurrency = 1**, ≥ 2 s between calls
- [ ] Token-bucket limiter with a **hard hourly cap** (default 200) that *blocks*, not warns
- [ ] Persistent hourly call counter that survives restarts (a rolling window in a small file/SQLite)
- [ ] **Dry-run mode by default** for every write path; `--live` required to actually mutate
- [ ] Exponential backoff with jitter on 429/5xx; honour `Retry-After` if present; **cap at 3
      retries then abort** — never retry indefinitely
- [ ] Do **not** retry 4xx other than 401-once (400/403/404/422 are our bug, not transient)
- [ ] Full request/response logging (Best Practices: *"Keep a log of all the Flipkart API requests
      and responses"*) — with credentials and tokens redacted
- [ ] Tolerant response parsing: *"Ensure that your client applications are ready to handle changes
      to the response structure and do not break when new fields are added"*, and *"the response
      elements and fields are not returned in any particular sequence"* — never depend on field order
- [ ] Batch chunking at 10 (writes) / 500 (search reads) with checkpoint + resume
- [ ] HTTPS only

### Known response codes
`200` success · `202` accepted/processing · `400` bad request · `403` forbidden ·
`404` not found · `422` unprocessable entity · `500` internal · `503` unavailable ·
`599` connection timed out. (`401` = expired/invalid token, per the auth section.)

Note: **429 is not in Flipkart's published response-code table**, even though rate limits exist.
Treat *any* unexpected 4xx/5xx burst as a possible throttle: **stop the job, back off, tell
Deepak.** Don't guess and hammer.

---

## 9. Doc sources (mirrored locally — read these, don't re-fetch)

Local text mirror of all pages:
`/private/tmp/claude-501/-Volumes-Deepak-LIVE-me/<session>/scratchpad/fk/*.txt`
(Re-mirror if the session dir is gone; don't scrape repeatedly.)

Live sources:
- Index: https://seller.flipkart.com/api-docs/fmsapi_index.html
- Getting started / auth: https://seller.flipkart.com/api-docs/FMSAPI.html
- Best practices: https://seller.flipkart.com/api-docs/best_practices.html
- Response codes: https://seller.flipkart.com/api-docs/errors.html
- FAQ: https://seller.flipkart.com/api-docs/FAQ.html
- Listing API ref: https://seller.flipkart.com/api-docs/listing-api-docs/LMAPIRef.html
- Seller FTP (bulk): https://seller.flipkart.com/api-docs/listing-api-docs/LMAPIFtp.html
- Order API ref: https://seller.flipkart.com/api-docs/order-api-docs/OMAPIRef.html
- Notifications: https://seller.flipkart.com/api-docs/order-api-docs/NotifIntro.html
- Reports: https://seller.flipkart.com/api-docs/reports-api-docs/RMAPIOverview.html
- Changelog: https://seller.flipkart.com/api-docs/changelog.html
- **Licence Agreement (the rate limits live here, Exhibit B):**
  https://seller.flipkart.com/api-docs/_static/images/APILicAgreement.pdf
  (the `img1a.flixcart.com` URL in `doc.md` is dead — returns `NoSuchBucket`)
- Swagger: https://api.flipkart.net/swagger/swagger.json

**Versioning warning (Exhibit C):** when a new API version ships to Production, the old one is
supported for only **3 calendar months**, then shut down in both Production and Sandbox. Two
reminder emails are sent. Watch the changelog; pin the version in the client and review quarterly.

### Support contacts
- API queries / tickets: Seller Dashboard → raise ticket under **API GA** node
- Security breach reporting (24h): `seller-api-queries@flipkart.com`
- Reports API / commercial: `api-partner-support@flipkart.com`
