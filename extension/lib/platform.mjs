export const FIRST_OPTION = '__first_available_option__';

const key = (value) => String(value || '').replace(/[*]/g, '').replace(/\s+/g, ' ')
  .trim().toLowerCase();

export function normaliseDraftValue(platform, field) {
  const label = key(field.label);
  const raw = String(field.value).trim();
  if (platform === 'meesho' && label === 'gst') {
    const rate = raw.match(/(?:GST_)?(\d+(?:\.\d+)?)/i)?.[1];
    return rate ? { ...field, value: rate } : field;
  }
  if (platform === 'meesho' && label === 'shelf life (best before)' && /^\d+$/.test(raw)) {
    return { ...field, value: `${raw} Months` };
  }
  // Net Quantity (N) is an item count from a 1, 2, 3… list. A weight such as
  // "100 g" is a misread; a single item is the safe answer.
  if (platform === 'meesho' && label === 'net quantity (n)') {
    const count = Number(raw.match(
      /^(?:pack of\s*)?(\d+)\s*(?:n|nos?\.?|pcs?\.?|pieces?|items?|units?|packs?)?$/i)?.[1]);
    return count > 0
      ? { ...field, value: String(count) }
      : { ...field, value: '1', confidence: 'low',
          source: `${field.source}; "${raw}" is not an item count — defaulted to 1` };
  }

  const weight = raw.match(/^(\d+(?:\.\d+)?)\s*(g|kg)?$/i);
  if (!weight) return field;
  const amount = Number(weight[1]);
  if (platform === 'meesho' && label === 'net weight (gms)') {
    return { ...field, value: String(weight[2]?.toLowerCase() === 'kg' ? amount * 1000 : amount),
      source: `${field.source}; normalised to grams` };
  }
  if (label !== 'weight' || (weight[2]?.toLowerCase() !== 'g' && amount < 50)) return field;
  return { ...field, value: String(amount / 1000), confidence: 'medium',
    source: `${field.source}; converted grams to kg` };
}

export function resolveHouseDefault(platform, name, value) {
  let resolved = String(value);
  if (platform !== 'meesho') return resolved;
  if (name === 'tax_code') {
    const rate = resolved.match(/(?:GST_)?(\d+(?:\.\d+)?)/i)?.[1];
    if (rate) resolved = rate;
  }
  if (name === 'country_of_origin' && /^(?:in|india)$/i.test(resolved)) resolved = 'India';
  if (name === 'shelf_life_months') resolved = `${resolved} Months`;
  if (name === 'weight_kg' && Number.isFinite(Number(resolved))) {
    resolved = String(Number(resolved) * 1000);
  }
  return resolved;
}
