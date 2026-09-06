#!/usr/bin/env python3
"""Build seed/patterns.json from the Seller Hub listing export (.xls).
Usage:  python3 tools/build_seed.py <export.xls> [catalog_template.xls ...]
Requires: pip install xlrd
Runs entirely offline. Makes ZERO Flipkart API calls."""
import sys, os, re, json, collections, datetime, statistics
import xlrd

SKU_RX = re.compile(r'^([A-Z]+?)(SD|PD|FLT|LVT|ST|T)?_P(\d+)_(\d+)\s*(G|KG|ML|L)$')
LISTING_FIELDS = {
    'Fulfillment By': 'fulfilment_by', 'Procurement SLA': 'procurement_sla',
    'Procurement Type': 'procurement_type',
    'Package Length - Length of the package in cms': 'length_cm',
    'Package Breadth - Breadth of the package in cms': 'breadth_cm',
    'Package Height - Height of the package in cms': 'height_cm',
    'Package Weight - Weight of the package in Kgs': 'weight_kg',
    'Local Delivery Charge to Customer (per qty)': 'local_fee',
    'Zonal Delivery Charge to Customer (per qty)': 'zonal_fee',
    'National Delivery Charge to Customer (per qty)': 'national_fee',
    'Harmonized System Nomenclature - HSN': 'hsn', 'Tax Code': 'tax_code',
    'Country of Origin ISO code': 'country_of_origin',
    'Manufacturer Details': 'manufacturer_details',
    'Importer Details': 'importer_details', 'Packer Details': 'packer_details',
    'Shelf Life in Months': 'shelf_life_months',
}

def clean(v):
    s = str(v).strip()
    if s.endswith('.0'):
        s = s[:-2]
    return s

def read_listings(path):
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    hdr = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
    out = []
    for r in range(2, sh.nrows):          # row 1 is the description row
        d = {hdr[c]: sh.cell_value(r, c) for c in range(sh.ncols)}
        if clean(d.get('Seller SKU Id', '')):
            out.append(d)
    return out

def parse_sku(sku):
    m = SKU_RX.match(sku.strip().replace(' ', ''))
    if not m:
        return None
    return {'abbrev': m.group(1), 'form': m.group(2) or '',
            'pack_of': int(m.group(3)), 'quantity': int(m.group(4)), 'unit': m.group(5)}

def audit(rows):
    issues = []
    for d in rows:
        sku, title = clean(d['Seller SKU Id']), clean(d['Product Title'])
        sc = clean(d['Sub-category'])
        if sku != sku.replace(' ', ''):
            issues.append({'sku': sku, 'subcategory': sc, 'type': 'whitespace_in_sku',
                           'detail': 'SKU contains a space'})
        elif not parse_sku(sku):
            issues.append({'sku': sku, 'subcategory': sc, 'type': 'malformed_sku',
                           'detail': 'Does not match {ABBREV}{FORM}_P{n}_{qty}{UNIT}'})
        if sku and sku in title:
            issues.append({'sku': sku, 'subcategory': sc, 'type': 'sku_in_title',
                           'detail': 'Raw SKU leaked into the product title (Model Name)'})
    return issues

def defaults(rows):
    by = collections.defaultdict(list)
    for d in rows:
        by[clean(d['Sub-category'])].append(d)
    out = {}
    for sc, rs in by.items():
        vals, conf = {}, {}
        for col, key in LISTING_FIELDS.items():
            seen = [clean(r.get(col, '')) for r in rs if clean(r.get(col, ''))]
            if not seen:
                continue
            top, n = collections.Counter(seen).most_common(1)[0]
            vals[key] = top
            if n < len(seen):
                conf[key] = {'value': top, 'agreement': f'{n}/{len(seen)}',
                             'alternatives': sorted(set(seen) - {top})}
        # Prices vary per product, so use the category median rather than an
        # arbitrary first/mode value. These are editable drafting defaults.
        for col, key in (('MRP', 'mrp'), ('Your Selling Price', 'selling_price')):
            numbers = []
            for r in rs:
                try:
                    numbers.append(float(clean(r.get(col, '')).replace(',', '')))
                except ValueError:
                    pass
            if numbers:
                vals[key] = clean(statistics.median(numbers))
        out[sc] = {'n_listings': len(rs), 'defaults': vals, 'inconsistent': conf}
    return out

def abbrevs(rows):
    """Map product abbreviation -> the product words seen in its titles."""
    m = collections.defaultdict(collections.Counter)
    for d in rows:
        p = parse_sku(clean(d['Seller SKU Id']))
        if not p:
            continue
        title = clean(d['Product Title'])
        if clean(d['Seller SKU Id']) in title:      # skip broken titles
            continue
        m[p['abbrev'] + p['form']][title] += 1
    return {k: sorted(v) for k, v in sorted(m.items())}

def examples(rows, per_cat=6):
    by = collections.defaultdict(list)
    for d in rows:
        sc = clean(d['Sub-category'])
        sku, title = clean(d['Seller SKU Id']), clean(d['Product Title'])
        if sku in title:                 # never teach the model a broken title
            continue
        if len(by[sc]) < per_cat:
            by[sc].append({'sku': sku, 'title': title, 'mrp': clean(d.get('MRP', '')),
                           'selling_price': clean(d.get('Your Selling Price', ''))})
    return dict(by)

def sku_examples(rows):
    """Valid prior SKUs by category, including rows whose title needs cleanup."""
    by = collections.defaultdict(list)
    for d in rows:
        sku = clean(d['Seller SKU Id'])
        if parse_sku(sku):
            by[clean(d['Sub-category'])].append({
                'sku': sku, 'title': clean(d['Product Title'])})
    return dict(by)

def index_dropdowns(book):
    """The 'Index' sheet holds the allowed-value list for every dropdown
    attribute, one column per attribute (header on row 1)."""
    if 'Index' not in book.sheet_names():
        return {}
    sh = book.sheet_by_name('Index')
    out = {}
    for c in range(sh.ncols):
        head = str(sh.cell_value(1, c)).strip() if sh.nrows > 1 else ''
        if not head or head.lower() in ('tea', 'sub-categories in the file', 'please note',
                                        'allowed values'):
            continue
        vals = []
        for r in range(2, sh.nrows):
            v = str(sh.cell_value(r, c)).strip()
            if v and v not in vals:
                vals.append(v)
        if len(vals) >= 2:
            out.setdefault(head, vals)       # first column wins; later ones are duplicates
    return out


def ui_dropdowns(rows):
    """Allowed values we can prove from the seller's own live listings."""
    seen = collections.defaultdict(set)
    for d in rows:
        for col, key in (('Listing Status', 'Listing Status'),
                         ('Fulfillment By', 'Fullfilment by'),
                         ('Procurement Type', 'Procurement type'),
                         ('Tax Code', 'Tax Code')):
            v = clean(d.get(col, ''))
            if v:
                seen[key].add(v)
    out = {k: sorted(v) for k, v in seen.items()}
    # Values the form offers that this seller has not used yet.
    out.setdefault('Listing Status', [])
    for extra in ('ACTIVE', 'INACTIVE'):
        if extra not in out['Listing Status']:
            out['Listing Status'].append(extra)
    return out


def catalog_schema(path):
    """Extract the 96-column bulk catalogue schema + dropdown option lists."""
    b = xlrd.open_workbook(path)
    name = [s for s in b.sheet_names()
            if s not in ('Summary Sheet', 'Index', 'Listing FAQ Sheet', 'Image GuideLines',
                         'MatchingAttributes', 'VariantAttributes', 'Parent Variant Products',
                         'template_version') and not s.startswith('DropDownValuesForColumn')][0]
    sh = b.sheet_by_name(name)
    cols = []
    for c in range(sh.ncols):
        head = str(sh.cell_value(0, c)).strip()
        if not head:
            continue
        cols.append({'index': c, 'name': head,
                     'type': str(sh.cell_value(1, c)).strip().split('\n')[0],
                     'example': str(sh.cell_value(2, c)).strip(),
                     'help': str(sh.cell_value(3, c)).strip()})
    drops = {}
    for s in b.sheet_names():
        if s.startswith('DropDownValuesForColumn'):
            ds = b.sheet_by_name(s)
            idx = int(s.replace('DropDownValuesForColumn', ''))
            vals = [str(ds.cell_value(r, 0)).strip() for r in range(ds.nrows)
                    if str(ds.cell_value(r, 0)).strip()]
            head = next((c['name'] for c in cols if c['index'] == idx), f'col{idx}')
            drops[head] = vals
    # The Index sheet is richer than the per-column dropdown sheets - merge it in
    # and drop the exact duplicates the workbook carries.
    for k, v in index_dropdowns(b).items():
        drops[k] = v
    # A numeric column (MRP, price) can never have a text option list - the
    # workbook carries a stray sheet keyed to one. Drop those.
    numeric = {c['name'] for c in cols
               if any(t in c['type'].lower()
                      for t in ('integer', 'decimal', 'number', 'date', 'url'))}
    drops = {k: v for k, v in drops.items() if k not in numeric}

    dedup, seen_sig = {}, {}
    for k, v in drops.items():
        sig = tuple(v)
        if sig in seen_sig:
            continue
        seen_sig[sig] = k
        dedup[k] = v
    drops = dedup

    def col(sheet):
        return [str(sheet.cell_value(r, 0)).strip() for r in range(sheet.nrows)
                if str(sheet.cell_value(r, 0)).strip()]
    return {'vertical': name, 'columns': cols, 'dropdowns': drops,
            'matching_attributes': col(b.sheet_by_name('MatchingAttributes')),
            'variant_attributes': col(b.sheet_by_name('VariantAttributes'))}

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rows = read_listings(sys.argv[1])
    seed = {
        'generated_at': datetime.datetime.now().isoformat(timespec='seconds'),
        'source_export': os.path.basename(sys.argv[1]),
        'n_listings': len(rows),
        'sku_convention': {
            'pattern': '{ABBREV}{FORM}_P{packOf}_{quantity}{UNIT}',
            'forms': {'SD': 'Seed', 'PD': 'Powder', 'FLT': 'Flower Tea',
                      'LVT': 'Leaf Tea', 'ST': 'Stem/Strand Tea'},
            'note': ('ABBREV is a hand-made consonant contraction of the product name, '
                     '2-8 chars. It is NOT algorithmic - always reuse the existing abbrev '
                     'for a known product; only coin a new one for a genuinely new product.'),
        },
        'abbrev_to_products': abbrevs(rows),
        'categories': defaults(rows),
        'title_examples': examples(rows),
        'sku_examples': sku_examples(rows),
        'data_issues': audit(rows),
        'ui_dropdowns': ui_dropdowns(rows),
    }
    for p in sys.argv[2:]:
        seed.setdefault('catalog_templates', {})
        s = catalog_schema(p)
        seed['catalog_templates'][s['vertical']] = s
    dest = os.path.join(os.path.dirname(__file__), '..', 'seed', 'patterns.json')
    with open(dest, 'w') as f:
        json.dump(seed, f, indent=2)
    print(f'wrote {os.path.abspath(dest)}')
    print(f'  {len(rows)} listings, {len(seed["categories"])} categories, '
          f'{len(seed["data_issues"])} data issues')

if __name__ == '__main__':
    main()
