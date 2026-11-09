// Telegram bot (Spanish): people report prices, set their wallet, and get paid in wARS.
// Uses plain long polling against the Bot API, so there are no extra dependencies.
import { isAddress, getAddress } from 'viem';
import { load, save } from './store.js';
import { BASKET, findProduct } from './basket.js';
import { addReport, payConfirmed, computeIndex, official, RULES } from './agent.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const tx = (h) => `https://celoscan.io/tx/${h}`;

async function send(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

// "1.450" -> 1450 · "1.450,50" -> 1450.5 · "$1450" -> 1450
export function parsePrice(s) {
  let t = s.replace(/[$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "leche 1450 coto palermo" -> { product, price, place }
export function parseReport(text) {
  const m = text.match(/^(.*?)\s+\$?\s*([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  const product = findProduct(m[1]);
  const price = parsePrice(m[2]);
  return product && price ? { product: product.id, price, place: m[3].trim() } : null;
}

const HELP =
  `<b>Índice</b> 🇦🇷 La inflación de Argentina, todos los días, hecha por la gente.\n\n` +
  `Mandás precios que ves en tu barrio y te pagamos <b>${RULES.rewardWars} wARS</b> (pesos digitales en Celo) por cada precio confirmado.\n\n` +
  `<b>1.</b> Registrá tu billetera de Celo (MiniPay, Valora, MetaMask):\n<code>/billetera 0xTuDireccion</code>\n\n` +
  `<b>2.</b> Mandá un precio así:\n<code>leche 1450 coto palermo</code>\n<code>pan 2800 panadería la esquina</code>\n\n` +
  `<b>3.</b> Cuando <b>otra persona</b> reporta un precio parecido (±${RULES.agreePct * 100}%) en ${RULES.windowHours} h, el precio se confirma y les pagamos a los dos.\n\n` +
  `/indice: ver el índice de hoy\n/productos: qué precios buscamos\n/mis: tus reportes y pagos\n/english: read this in English`;

const HELP_EN =
  `<b>Índice</b> 🇦🇷 Argentina's inflation, every day, made by people.\n\n` +
  `Send prices you see in your neighbourhood and get paid <b>${RULES.rewardWars} wARS</b> (digital Argentine pesos on Celo) for every confirmed price.\n\n` +
  `<b>1.</b> Save your Celo wallet (MiniPay, Valora, MetaMask):\n<code>/billetera 0xYourAddress</code>  (billetera = wallet)\n\n` +
  `<b>2.</b> Send a price like this (product, price, place):\n<code>leche 1450 coto palermo</code>  (leche = milk)\n<code>pan 2800 la esquina</code>  (pan = bread)\n\n` +
  `<b>3.</b> When <b>another person</b> reports a similar price (±${RULES.agreePct * 100}%) within ${RULES.windowHours} h, the price is confirmed and you both get paid.\n\n` +
  `/indice: today's index\n/productos: the products we track\n/mis: your reports and payments`;

async function handle(msg) {
  const chatId = msg.chat.id, tgId = String(msg.from.id), name = msg.from.first_name || 'anon';
  const text = (msg.text || '').trim();
  if (!text) return;
  const [cmd, ...rest] = text.split(/\s+/);
  const c = cmd.toLowerCase().replace(/@.*$/, '');

  if (c === '/start' || c === '/ayuda') return send(chatId, HELP);
  if (c === '/english' || c === '/help') return send(chatId, HELP_EN);

  if (c === '/billetera' || c === '/wallet') {
    const a = rest[0];
    if (!a || !isAddress(a)) return send(chatId, 'Mandá tu dirección así: <code>/billetera 0x...</code>');
    const db = load(); db.users[tgId] = { name, wallet: getAddress(a), since: db.users[tgId]?.since || Date.now() }; save(db);
    return send(chatId, `✅ Billetera guardada: <code>${getAddress(a)}</code>\nAhora mandá un precio, por ejemplo: <code>leche 1450 coto</code>`);
  }

  if (c === '/productos') return send(chatId, '<b>Canasta de Índice</b>\n' + BASKET.map((p) => `• ${p.name} (escribí: <code>${p.aliases[0]}</code>)`).join('\n'));

  if (c === '/indice') {
    const ix = computeIndex(); const off = await official();
    if (!ix.latest) return send(chatId, 'Todavía no hay precios confirmados. ¡Sé de los primeros en reportar!');
    return send(chatId,
      `<b>Índice hoy (${ix.latest.day})</b>: ${ix.latest.level}` +
      (ix.dailyChangePct !== null ? ` (${ix.dailyChangePct >= 0 ? '+' : ''}${ix.dailyChangePct}% vs ayer)` : '') +
      `\nProductos cubiertos: ${ix.latest.coverage}/${BASKET.length} · Precios confirmados: ${ix.confirmedReports}` +
      `\nOficial INDEC (vía BCRA): ${off.monthlyPct ?? '?'}% mensual (${off.month ?? ''}), ${off.yearlyPct ?? '?'}% anual`);
  }

  if (c === '/mis') {
    const db = load(); const mine = db.reports.filter((r) => r.tgId === tgId);
    const earned = mine.filter((r) => r.paid).length * RULES.rewardWars;
    return send(chatId, `Reportes: ${mine.length} · Confirmados: ${mine.filter((r) => r.confirmed).length} · Cobrado: <b>${earned} wARS</b>` +
      (mine.filter((r) => r.payTx).slice(-3).map((r) => `\n${tx(r.payTx)}`).join('')));
  }

  const rep = parseReport(text.replace(/^\/precio\s+/i, ''));
  if (!rep) return send(chatId, 'No entendí 🤔 Probá así: <code>leche 1450 coto</code>\n/productos para ver la lista.');
  const res = await addReport({ tgId, name, ...rep });
  if (res.error === 'no_wallet') return send(chatId, 'Primero registrá tu billetera: <code>/billetera 0x...</code>');
  if (res.error === 'outlier') return send(chatId, `Ese precio está muy lejos de lo que reporta la gente (mediana ~$${Math.round(res.median)}). ¿Lo revisás?`);
  await send(chatId, res.report.confirmed
    ? `✅ <b>${res.productName}</b> a $${rep.price}: ¡confirmado por otra persona! Te pagamos en un momento.`
    : `📝 Recibido: <b>${res.productName}</b> a $${rep.price}. Cuando otra persona confirme un precio parecido, cobrás ${RULES.rewardWars} wARS.`);
  await runPayouts();
}

let paying = false;
export async function runPayouts() {
  if (paying) return; paying = true;
  try {
    for (const p of await payConfirmed()) {
      if (p.error) { console.log('payout skipped:', p); continue; }
      console.log('paid', p.amountWars, 'wARS to', p.to, p.tx);
      for (const id of p.tgIds) await send(id, `💸 Te pagamos <b>${p.amountWars} wARS</b> por precios confirmados.\n${tx(p.tx)}`);
    }
  } catch (e) { console.error('payout error:', e.shortMessage || e.message); }
  finally { paying = false; }
}

export async function startBot() {
  if (!TOKEN) { console.log('TELEGRAM_BOT_TOKEN missing: bot not started'); return; }
  let offset = 0;
  console.log('Telegram bot polling…');
  for (;;) {
    try {
      const r = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(40000) });
      const { result = [] } = await r.json();
      for (const u of result) { offset = u.update_id + 1; if (u.message) await handle(u.message).catch((e) => console.error(e)); }
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
}
