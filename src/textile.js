// Textile FX RFQ client (keyless taker flow, Celo mainnet).
// Docs: https://fx-docs.textilecredit.com/api/v2/rfq.html
import crypto from 'node:crypto';
import { toHex } from 'viem';
import { pub, wallet, account, erc20 } from './chain.js';

const API = 'https://api.textilecredit.com/v2';
const CHAIN_ID = 42220;

async function takerProof() {
  const nonce = toHex(crypto.randomBytes(32));
  const issuedAt = Date.now();
  const signature = await account.signTypedData({
    domain: { name: 'Textile Taker Control', version: '1', chainId: CHAIN_ID },
    types: { TakerControl: [
      { name: 'taker', type: 'address' }, { name: 'chainId', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }, { name: 'issuedAt', type: 'uint256' },
    ] },
    primaryType: 'TakerControl',
    message: { taker: account.address, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}

// Free indicative price. Returns how much buyToken you get for sellAmount (atomic units).
export async function preview(sellToken, buyToken, sellAmount) {
  const r = await fetch(`${API}/rfq/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId: CHAIN_ID, sellToken, buyToken, sellAmount: String(sellAmount) }),
  });
  return (await r.json()).data;
}

// Firm quote + approve + swap. Our tag rides on the swap tx via the tagged wallet client.
export async function swap(sellToken, buyToken, sellAmount) {
  const body = { chainId: CHAIN_ID, sellToken, buyToken, sellAmount: String(sellAmount), taker: account.address };
  const send = (extra = {}) => fetch(`${API}/rfq/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...extra }), signal: AbortSignal.timeout(75_000),
  });
  let r = await send();
  if (r.status === 401) r = await send({ takerProof: await takerProof() });
  const { data } = await r.json();
  if (!data || data.status !== 'quoted') throw new Error(`no quote: ${data?.reason || r.status}`);
  const { rfqId, claimToken, quote, transactions } = data;
  const need = BigInt(quote.takerPays);

  const allowance = await pub.readContract({ address: sellToken, abi: erc20, functionName: 'allowance', args: [account.address, quote.reactor] });
  if (allowance < need) {
    if (allowance > 0n) {
      const h0 = await wallet.writeContract({ address: sellToken, abi: erc20, functionName: 'approve', args: [quote.reactor, 0n] });
      await pub.waitForTransactionReceipt({ hash: h0 });
    }
    const h1 = await wallet.sendTransaction({ to: transactions.approval.to, data: transactions.approval.data, value: 0n });
    await pub.waitForTransactionReceipt({ hash: h1 });
  }
  if (Date.now() >= Date.parse(quote.expiresAt)) throw new Error('quote expired, retry');
  const hash = await wallet.sendTransaction({ to: transactions.swap.to, data: transactions.swap.data, value: 0n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  fetch(`${API}/rfq/${rfqId}/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rfq-Claim': claimToken },
    body: JSON.stringify({ txHash: hash }),
  }).catch(() => {});
  return { hash, status: receipt.status, sold: quote.takerPays, bought: quote.buyAmount };
}
