// Indice's brain: check reports against each other, pay confirmed ones in wARS, build the index.
import { formatUnits, parseUnits } from 'viem';
import { load, save } from './store.js';
import { BASKET, byId } from './basket.js';
import { pub, wallet, account, TOKENS, erc20 } from './chain.js';

// ---- Rules (hard limits, also listed in the README) ----
export const RULES = {
  rewardWars: Number(process.env.REWARD_WARS || 50),          // paid per confirmed report
  agreePct: Number(process.env.AGREE_PCT || 0.05),            // two reports "agree" within ±5%
  windowHours: Number(process.env.WINDOW_HOURS || 48),        // ...and within 48 hours
  dailyBudgetWars: Number(process.env.DAILY_BUDGET_WARS || 600), // whole agent, per day
  perUserDaily: Number(process.env.PER_USER_DAILY || 5),      // paid reports per person per day
};

const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// A report is confirmed when a DIFFERENT person (different Telegram user AND different wallet)
// reported the same product at a price within ±agreePct inside the time window.
function confirmReports(db) {
  const win = RULES.windowHours * 3600e3;
  for (const r of db.reports) {
    if (r.confirmed) continue;
    const match = db.reports.find((o) => o !== r && o.product === r.product && o.tgId !== r.tgId &&
      o.wallet.toLowerCase() !== r.wallet.toLowerCase() && Math.abs(o.ts - r.ts) <= win &&
      Math.abs(o.price - r.price) / Math.min(o.price, r.price) <= RULES.agreePct);
    if (match) { r.confirmed = true; r.confirmedWith = match.id; match.confirmed = true; match.confirmedWith ??= r.id; }
  }
}

export async function addReport({ tgId, name, product, price, place }) {
  const db = load();
  const user = db.users[tgId];
  if (!user?.wallet) return { error: 'no_wallet' };
  const p = byId[product];
  // sanity: reject prices wildly off the current confirmed median (typos, trolling)
  const recent = db.reports.filter((r) => r.product === product && r.confirmed).map((r) => r.price);
  if (recent.length >= 3) { const m = median(recent); if (price < m / 4 || price > m * 4) return { error: 'outlier', median: m }; }
  const r = { id: db.reports.length + 1, tgId, name, wallet: user.wallet, product, price, place: place || '', ts: Date.now(), confirmed: false, paid: false };
  db.reports.push(r);
  confirmReports(db);
  save(db);
  return { report: r, productName: p.name };
}

// Pays every confirmed-but-unpaid report, one wARS transfer per person, inside the caps.
export async function payConfirmed() {
  const db = load();
  const today = day(Date.now());
  let spentToday = db.payouts.filter((p) => day(p.ts) === today).reduce((s, p) => s + p.amountWars, 0);
  const paidCount = {};
  db.reports.filter((r) => r.paid && day(r.paidAt) === today).forEach((r) => { paidCount[r.tgId] = (paidCount[r.tgId] || 0) + 1; });

  const groups = {};
  for (const r of db.reports.filter((r) => r.confirmed && !r.paid)) {
    if ((paidCount[r.tgId] || 0) >= RULES.perUserDaily) continue;
    if (spentToday + RULES.rewardWars > RULES.dailyBudgetWars) break;
    paidCount[r.tgId] = (paidCount[r.tgId] || 0) + 1;
    spentToday += RULES.rewardWars;
    (groups[r.wallet] ||= []).push(r);
  }
  const results = [];
  for (const [to, reps] of Object.entries(groups)) {
    const amountWars = reps.length * RULES.rewardWars;
    const bal = await pub.readContract({ address: TOKENS.wARS.address, abi: erc20, functionName: 'balanceOf', args: [account.address] });
    if (bal < parseUnits(String(amountWars), 18)) { results.push({ to, error: 'treasury_low' }); continue; }
    const hash = await wallet.writeContract({ address: TOKENS.wARS.address, abi: erc20, functionName: 'transfer', args: [to, parseUnits(String(amountWars), 18)] });
    await pub.waitForTransactionReceipt({ hash });
    const fresh = load();
    for (const r of reps) { const fr = fresh.reports.find((x) => x.id === r.id); fr.paid = true; fr.paidAt = Date.now(); fr.payTx = hash; }
    fresh.payouts.push({ to, tgIds: [...new Set(reps.map((r) => r.tgId))], reportIds: reps.map((r) => r.id), amountWars, tx: hash, ts: Date.now() });
    save(fresh);
    results.push({ to, amountWars, tx: hash, tgIds: [...new Set(reps.map((r) => r.tgId))] });
  }
  return results;
}

// Official numbers from Argentina's central bank (BCRA): monthly (27) and yearly (28) inflation.
let officialCache = { at: 0, data: null };
export async function official() {
  if (Date.now() - officialCache.at < 3600e3 && officialCache.data) return officialCache.data;
  try {
    const r = await fetch('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=2000', { signal: AbortSignal.timeout(15000) });
    const rows = (await r.json()).results;
    const get = (id) => rows.find((x) => x.idVariable === id);
    const m = get(27), y = get(28);
    officialCache = { at: Date.now(), data: { source: 'BCRA (INDEC)', monthlyPct: m?.ultValorInformado, yearlyPct: y?.ultValorInformado, month: m?.ultFechaInformada } };
  } catch { officialCache = { at: Date.now(), data: { source: 'BCRA (INDEC)', error: 'unavailable' } }; }
  return officialCache.data;
}

// The index: per product per day take the median confirmed price; carry the last known price
// forward; index(day) = 100 × weighted geometric mean of price relatives vs each product's first day.
export function computeIndex() {
  const db = load();
  const conf = db.reports.filter((r) => r.confirmed);
  const days = [...new Set(conf.map((r) => day(r.ts)))].sort();
  const base = {}, last = {}, series = [];
  for (const d of days) {
    for (const p of BASKET) {
      const xs = conf.filter((r) => r.product === p.id && day(r.ts) === d).map((r) => r.price);
      if (xs.length) { last[p.id] = median(xs); base[p.id] ??= last[p.id]; }
    }
    const have = BASKET.filter((p) => base[p.id]);
    const wsum = have.reduce((s, p) => s + p.weight, 0);
    const level = 100 * Math.exp(have.reduce((s, p) => s + (p.weight / wsum) * Math.log(last[p.id] / base[p.id]), 0));
    series.push({ day: d, level: +level.toFixed(2), coverage: have.length });
  }
  const latest = series.at(-1);
  const prev = series.at(-2);
  return {
    name: 'Índice: inflación diaria de Argentina, hecha por la gente',
    latest: latest || null,
    dailyChangePct: latest && prev ? +(((latest.level / prev.level) - 1) * 100).toFixed(2) : null,
    basket: BASKET.map((p) => ({ id: p.id, name: p.name, weight: p.weight, lastPrice: last[p.id] ?? null, basePrice: base[p.id] ?? null })),
    series,
    confirmedReports: conf.length,
    totalReports: db.reports.length,
    reporters: Object.keys(db.users).length,
    paidOutWars: db.payouts.reduce((s, p) => s + p.amountWars, 0),
    method: 'Median of confirmed reports per product per day; weighted geometric mean of price relatives (Jevons-style); last price carried forward.',
  };
}

export async function treasury() {
  const [wars, usdt] = await Promise.all([
    pub.readContract({ address: TOKENS.wARS.address, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
    pub.readContract({ address: TOKENS.USDT.address, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
  ]);
  return { address: account.address, wARS: +formatUnits(wars, 18), USDT: +formatUnits(usdt, 6) };
}
