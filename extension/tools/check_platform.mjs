import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIRST_OPTION, normaliseDraftValue, resolveHouseDefault }
  from '../lib/platform.mjs';

assert.equal(FIRST_OPTION, '__first_available_option__');
assert.equal(resolveHouseDefault('meesho', 'tax_code', 'GST_5'), '5');
assert.equal(resolveHouseDefault('meesho', 'weight_kg', '0.3'), '300');
assert.equal(resolveHouseDefault('meesho', 'shelf_life_months', '24'), '24 Months');
assert.equal(normaliseDraftValue('meesho', {
  label: 'GST', value: 'GST_5', source: 'default', confidence: 'low',
}).value, '5');
assert.equal(normaliseDraftValue('meesho', {
  label: 'Net Weight (gms)', value: '0.4 kg', source: 'label', confidence: 'high',
}).value, '400');
assert.equal(normaliseDraftValue('flipkart', {
  label: 'Weight', value: '400 g', source: 'label', confidence: 'high',
}).value, '0.4');

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url)));
assert.equal(manifest.version, '1.2.1');
assert(manifest.host_permissions.includes('https://supplier.meesho.com/*'));
assert(manifest.content_scripts[0].matches.includes('https://supplier.meesho.com/*'));

console.log('platform checks passed');
