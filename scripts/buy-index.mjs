// Example customer: another agent buys Índice's full index over x402, paying in wARS.
// Needs BUYER_PRIVATE_KEY (a wallet holding a little wARS; no CELO needed, gas is sponsored).
// Usage: node scripts/buy-index.mjs [url]   (default http://localhost:8787/api/index)
import 'dotenv/config';
import { config } from 'dotenv';
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';

config({ path: '.env.buyer' });
if (!process.env.BUYER_PRIVATE_KEY) throw new Error('BUYER_PRIVATE_KEY missing (put it in .env.buyer)');
const url = process.argv[2] || 'http://localhost:8787/api/index';
const WARS = getAddress('0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D');

const buyer = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY);
const client = new x402Client();
// wARS isn't in the library's default (USD) asset table, so allow it explicitly, capped at 200 wARS per call.
client.setSpendControls({ allowedAssets: [{ network: 'eip155:42220', asset: WARS, maxAmountPerPayment: (200n * 10n ** 18n).toString() }] });
client.register('eip155:*', new ExactEvmScheme(buyer, { rpcUrl: 'https://forno.celo.org' }));
const payFetch = wrapFetchWithPayment(fetch, client);

console.log('buyer:', buyer.address, '→', url);
const res = await payFetch(url);
const receipt = res.headers.get('payment-response');
console.log('HTTP', res.status);
if (receipt) {
  const r = JSON.parse(Buffer.from(receipt, 'base64').toString());
  console.log('settled:', r.success, '| tx:', r.transaction ? `https://celoscan.io/tx/${r.transaction}` : r);
}
const body = await res.json();
console.log(JSON.stringify({ latest: body.latest, confirmedReports: body.confirmedReports, basketItems: body.basket?.length }, null, 0));
