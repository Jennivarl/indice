// Registers Indice's ERC-8004 agent identity on Celo mainnet, from the agent wallet.
// The registration file is stored on-chain as a data: URI (no hosting needed).
// Run once: node scripts/register-8004.mjs
import { parseAbi, parseEventLogs } from 'viem';
import { verifyTx } from '@celo/attribution-tags';
import { pub, wallet, account, IDENTITY_REGISTRY, TAG } from '../src/chain.js';

const registration = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Indice',
  description:
    "Indice builds Argentina's inflation number every day from prices reported by real people, " +
    'pays each confirmed report in wARS on Celo, and sells the index to agents and apps per call.',
  services: [{ name: 'wallet', endpoint: `eip155:42220:${account.address}` }],
  x402Support: true,
  active: true,
  supportedTrust: ['reputation'],
};
const agentURI =
  'data:application/json;base64,' + Buffer.from(JSON.stringify(registration)).toString('base64');

const abi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]);

console.log('Agent wallet:', account.address, '| tag:', TAG);
const { request } = await pub.simulateContract({
  account, address: IDENTITY_REGISTRY, abi, functionName: 'register', args: [agentURI],
});
const hash = await wallet.writeContract(request);
console.log('tx sent:', hash);
const receipt = await pub.waitForTransactionReceipt({ hash });
const [ev] = parseEventLogs({ abi, eventName: 'Registered', logs: receipt.logs });
console.log('status:', receipt.status, '| agentId:', ev?.args.agentId?.toString());
console.log('tag check:', JSON.stringify(await verifyTx({ client: pub, hash })));
console.log(`https://celoscan.io/tx/${hash}`);
