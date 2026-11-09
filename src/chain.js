// Shared Celo mainnet clients. Every transaction sent through `wallet`
// carries our ERC-8021 attribution tag (required by the hackathon).
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { withAttribution } from '@celo/attribution-tags';

export const TAG = process.env.ATTRIBUTION_CODE; // celo_17d218c9c0b2
if (!TAG) throw new Error('ATTRIBUTION_CODE missing in .env');
if (!process.env.AGENT_PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY missing in .env');

export const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const transport = http(process.env.CELO_RPC || 'https://forno.celo.org');

export const pub = createPublicClient({ chain: celo, transport });
export const wallet = createWalletClient({ account, chain: celo, transport }).extend(withAttribution(TAG));

export const TOKENS = {
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  wARS: { address: '0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D', decimals: 18 },
};
export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);
