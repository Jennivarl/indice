// Buys wARS with USD₮ on Textile FX so the agent can pay reporters in pesos.
// Usage: node scripts/fund-rewards.mjs 1.1   (amount in USD₮, minimum about $1)
import { formatUnits, parseUnits } from 'viem';
import { verifyTx } from '@celo/attribution-tags';
import { pub, TOKENS } from '../src/chain.js';
import { swap } from '../src/textile.js';

const usd = process.argv[2] || '1.1';
const res = await swap(TOKENS.USDT.address, TOKENS.wARS.address, parseUnits(usd, 6));
console.log('swap status:', res.status);
console.log('sold USD₮:', formatUnits(BigInt(res.sold), 6), '| bought wARS:', formatUnits(BigInt(res.bought), 18));
console.log('tag check:', JSON.stringify(await verifyTx({ client: pub, hash: res.hash })));
console.log(`https://celoscan.io/tx/${res.hash}`);
