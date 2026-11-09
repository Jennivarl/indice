// Offline tests: price parsing, report parsing, product matching. No chain, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.ATTRIBUTION_CODE ||= 'celo_test1234';
process.env.AGENT_PRIVATE_KEY ||= '0x' + '11'.repeat(32);
const { parsePrice, parseReport } = await import('../src/bot.js');
const { findProduct } = await import('../src/basket.js');

test('parses Argentine price formats', () => {
  assert.equal(parsePrice('1450'), 1450);
  assert.equal(parsePrice('1.450'), 1450);
  assert.equal(parsePrice('1.450,50'), 1450.5);
  assert.equal(parsePrice('$2800'), 2800);
  assert.equal(parsePrice('abc'), null);
});

test('parses a report message', () => {
  assert.deepEqual(parseReport('leche 1450 coto palermo'), { product: 'leche', price: 1450, place: 'coto palermo' });
  assert.deepEqual(parseReport('carne picada 9.800 carnicería'), { product: 'carne', price: 9800, place: 'carnicería' });
  assert.equal(parseReport('hola'), null);
});

test('matches products with accents and aliases', () => {
  assert.equal(findProduct('Azúcar')?.id, 'azucar');
  assert.equal(findProduct('pan francés')?.id, 'pan');
  assert.equal(findProduct('bondi')?.id, 'colectivo');
});
