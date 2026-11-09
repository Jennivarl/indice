# Índice 🇦🇷

**Argentina's inflation number, every day, made by people who get paid in pesos.**

Índice is an AI agent on Celo mainnet. People send it prices they see in their neighbourhood. When a second, independent person confirms a price, the agent pays both of them in **wARS** (Ripio's digital Argentine peso). From the confirmed prices it builds a **daily inflation index**, then sells that index to other agents and apps **per call, in pesos, over x402**.

- Agent wallet: [`0x8c4B5BF71fef22d0eE3D411A3964d3579248478A`](https://celoscan.io/address/0x8c4B5BF71fef22d0eE3D411A3964d3579248478A)
- ERC-8004 identity: **agentId 10062** ([registration tx](https://celoscan.io/tx/0x3d2ce9f87ed352b24e13e2e46b48c0b664c15ca381f6facb7bf335f7dd87bbeb))
- Attribution tag (ERC-8021): `celo_17d218c9c0b2` on every transaction the agent sends
- Telegram bot: [@IndiceDiarioBot](https://t.me/IndiceDiarioBot)

**First confirmed price on mainnet:** two people on two Telegram accounts reported milk at 1,450 and 1,480 pesos (within 5%). The agent confirmed it and paid each of them 50 wARS automatically: [payout 1](https://celoscan.io/tx/0x37e98406c25802ce6a8c41cf1dd6243d2234668345822617c6f9eafa9895f318), [payout 2](https://celoscan.io/tx/0xedf77f44be81f37fdb4afc1f263901509d7c838dcbefb56bfe1a43c786dfb902). The two receiving wallets were created for this test.

---

## The problem

Argentina watches one number more closely than almost any country: monthly inflation. Rents, salaries and shop prices are reset by it. But the official figure from INDEC comes out **once a month, weeks late**. September's 1.9% was published in October, and October's figure comes out on 12 November. Everyone sets prices from a number that is already old.

Professional daily price trackers exist, but they're sold to banks. Nobody builds an open daily number with the people who actually see the prices.

## What Índice does

1. **People report prices** on Telegram, in plain Spanish: `leche 1450 coto palermo`.
2. **The agent never trusts one person.** A price is confirmed only when a *different* person (different Telegram account **and** different wallet) reports the same product within ±5% inside 48 hours.
3. **Confirmed prices are paid in wARS** straight to the reporter's Celo wallet, from the agent's own treasury. Each payment is a public on-chain transfer.
4. **The agent builds the index** every day from the median confirmed price of each product in an 11-item basket (bread, milk, meat, eggs, yerba, rice, pasta, oil, sugar, potatoes, bus fare).
5. **It sells the index** at `GET /api/index`, priced at 100 wARS per call through Celo's x402 facilitator. A free summary and the full public books are open to everyone.

### Who pays whom

Like a newspaper: **customers pay for the number, and the agent pays the people who collect the prices.** Reporters never deposit anything, so no user money is ever at risk. At launch the builder seeds the treasury, the same way any new business starts.

### The agent's hard rules (in code, `src/agent.js`)

| Rule | Default |
|---|---|
| Reward per confirmed price | 50 wARS |
| Two reports "agree" if within | ±5%, 48 h, different person **and** different wallet |
| Agent's total daily budget | 600 wARS |
| Max paid reports per person per day | 5 |
| Outlier guard | rejects prices more than 4× away from the current median |

A cheater can take a few cents a day at most, and every payment is public.

## Celo stack used

- **wARS (Ripio wFIAT)**: the currency people earn, and the currency agents pay with.
- **Textile FX**: the agent bought its peso treasury on Textile's RFQ market without an API key (1.10 USD₮ → 1,824.84 wARS, [tx](https://celoscan.io/tx/0x1932c3db5674c2a94157de8328055fd7e3538f9065b19b97f4c9fe4bdfdc58e1)).
- **x402 via Celo's facilitator**: the index is sold per call in wARS (Permit2 asset, gasless for the buyer). First paid call on mainnet: 100 wARS, [settlement tx](https://celoscan.io/tx/0xab13e3df2b8df677ae1f3c70cc929a9828f80c0171f287cefffe914d1dd77ea1) (the buyer was our own demo customer wallet, `scripts/buy-index.mjs`).
- **ERC-8004**: agentId 10062, registered from the agent wallet.
- **ERC-8021 attribution tags**: every agent transaction carries `celo_17d218c9c0b2` (verified with `verifyTx`).
- **Official data**: BCRA's public API (INDEC monthly and yearly inflation) is shown next to Índice's number.

> Note: x402 settlements are submitted by the facilitator and can't carry attribution tags yet. The PayTo wallet is the agent wallet above.

## How it's built

```
src/
  chain.js     Celo clients; every tx is tagged via withAttribution()
  textile.js   Textile FX RFQ taker (keyless): preview, firm quote, approve, swap
  basket.js    the 11-product basket, weights and Spanish aliases
  agent.js     confirm reports, pay in wARS (with caps), compute the index, BCRA data
  bot.js       Telegram bot in Spanish (long polling, no extra deps)
  server.js    dashboard + /api/summary + /api/books + paid /api/index (x402)
  store.js     small JSON file store (data/db.json)
scripts/
  register-8004.mjs   registers the agent's ERC-8004 identity
  fund-rewards.mjs    buys wARS with USD₮ on Textile for the reward treasury
  buy-index.mjs       example customer: pays 100 wARS over x402 for the full index
test/core.test.js     offline tests for parsing and product matching
```

**Index method:** for each product and day, take the median of confirmed prices; carry the last known price forward; index = 100 × weighted geometric mean of each product's price relative to its first observed price.

---

## How to Test

### What you need

- **Node.js 20.12 or newer** (check with `node -v`)
- **Git**
- A **Celo wallet with a little CELO** for gas (about $0.10 is plenty) and some **USD₮ on Celo** if you want to fund rewards (at least $1.10, which is Textile's minimum swap)
- A **Telegram account** (to create a bot with @BotFather)
- Optional: an **x402 API key** from https://x402.celo.org, only needed to sell the index

### 1. Get the code and install

```bash
git clone https://github.com/Jennivarl/indice.git
cd indice
npm install
```

### 2. Run the offline tests (no wallet needed)

```bash
npm test
```

Expected: `pass 3`, `fail 0`.

### 3. Set up your environment

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `AGENT_PRIVATE_KEY` / `AGENT_ADDRESS`: a **new** wallet just for the agent (never your main wallet)
- `ATTRIBUTION_CODE`: your own tag if you're entering a hackathon, otherwise leave the example
- `TELEGRAM_BOT_TOKEN`: in Telegram, open **@BotFather**, send `/newbot`, follow the steps, and paste the token
- `X402_API_KEY` (optional): https://x402.celo.org → connect wallet → **Create API key**

Send a little CELO (gas) and some USD₮ to the agent address.

### 4. Register the agent and fund the rewards (one time)

```bash
npm run register        # ERC-8004 identity; prints the agentId and confirms the tag
npm run fund -- 1.1     # swaps 1.1 USD₮ to wARS on Textile; prints the tx
```

Expected: `status: success` and `tag check: {"codes":["<your code>"],...}` for both.

### 5. Start Índice

```bash
npm start
```

Expected in the terminal: `Web on http://localhost:8787` and `Telegram bot polling…`

### 6. Try it as a reporter (you need two Telegram accounts, or ask a friend)

1. Open your bot in Telegram and send `/start`. You'll get the instructions in Spanish (send `/english` for English).
2. Send `/billetera 0xYourCeloWallet`. Expected: `✅ Billetera guardada`.
3. Send a price, for example `leche 1450 coto`. Expected: `📝 Recibido…`
4. From a **second** Telegram account with a **different** wallet, send `/billetera 0xOtherWallet`, then `leche 1480 dia` (within 5%).
5. Expected: both accounts get `💸 Te pagamos 50 wARS…` with a Celoscan link. Open it to see the wARS transfer.
6. Send `/indice` to see the index next to INDEC's official figure.

### 7. Check the public books

- Dashboard: http://localhost:8787
- Free summary: http://localhost:8787/api/summary
- Every payout and the treasury balance: http://localhost:8787/api/books
- Paid index: `curl -i http://localhost:8787/api/index` should answer **HTTP 402** with the wARS price (when `X402_API_KEY` is set).

### 8. Buy the index like another agent would (optional, real money)

1. Create a file named `.env.buyer` with one line: `BUYER_PRIVATE_KEY=0x...` (a separate wallet).
2. Send that wallet at least **100 wARS**. It needs no CELO, because the facilitator sponsors the gas.
3. With Índice running, run:

```bash
npm run buy
```

Expected: `HTTP 200`, `settled: true` and a Celoscan link showing 100 wARS moving from the buyer to the agent wallet.

---

## Honest limits

- It's an MVP: the store is a JSON file and the bot runs on one machine.
- With few reporters, the index covers few products. Coverage grows with people.
- Two colluding people with two wallets could confirm each other's fake price. The caps limit the damage to cents, and the next step is matching against supermarkets' own online prices.
- The demo treasury is small (a few dollars), so rewards are small.

## What's next

- Cross-check against online supermarket prices, and weight trusted long-time reporters more.
- More basket items and regional indexes (by province).
- Add Brazil with wBRL (Textile already has a wBRL corridor), then other wFIAT countries as their on-chain liquidity arrives.
- Sell to the rent and salary agents that need a fresher inflation number.

## License

MIT
