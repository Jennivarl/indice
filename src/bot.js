// Telegram bot: people report prices, save their wallet, and get paid in wARS.
// Spanish first (the users are Argentine), with an English mode. Plain Bot API, no extra deps.
import fs from 'node:fs';
import path from 'node:path';
import { isAddress, getAddress } from 'viem';
import { load, save } from './store.js';
import { BASKET, findProduct } from './basket.js';
import { addReport, payConfirmed, computeIndex, official, RULES } from './agent.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const WEB = process.env.PUBLIC_URL || '';
const BANNER = path.resolve('assets/banner.png');
const txLink = (h, lang = 'es') => `<a href="https://celoscan.io/tx/${h}">${lang === 'en' ? 'view on Celoscan' : 'ver en Celoscan'} ↗</a>`;
const ars = (n) => '$' + Math.round(n).toLocaleString('es-AR');

async function call(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
const send = (chat_id, text, keyboard) => call('sendMessage', {
  chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
});

let bannerId = null; // Telegram file_id after the first upload
async function sendBanner(chatId, caption, keyboard) {
  if (bannerId) return call('sendPhoto', { chat_id: chatId, photo: bannerId, caption, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('reply_markup', JSON.stringify({ inline_keyboard: keyboard }));
  form.append('photo', new Blob([fs.readFileSync(BANNER)], { type: 'image/png' }), 'banner.png');
  const j = await (await fetch(`${API}/sendPhoto`, { method: 'POST', body: form })).json().catch(() => ({}));
  bannerId = j?.result?.photo?.at(-1)?.file_id || null;
  if (!j.ok) await send(chatId, caption, keyboard);
}

// ---------- parsing ----------
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

// ---------- language ----------
const langOf = (tgId) => load().users[tgId]?.lang || 'es';
function setLang(tgId, name, lang) { const db = load(); db.users[tgId] = { ...(db.users[tgId] || { name, since: Date.now() }), lang }; save(db); }

const T = {
  es: {
    welcome: (n) =>
      `<b>¡Hola, ${n}! Bienvenido a Índice</b> 🇦🇷\n\n` +
      `La inflación de Argentina, <b>todos los días</b>, hecha por la gente.\n\n` +
      `💬 Mandás precios que ves en tu barrio.\n` +
      `🤝 Cuando otra persona confirma un precio parecido, se valida.\n` +
      `💸 Cobrás <b>${RULES.rewardWars} wARS</b> (pesos digitales en Celo) por cada precio confirmado.`,
    menu: [[{ t: '📊 Índice de hoy', d: 'idx' }, { t: '🧺 Canasta', d: 'basket' }],
           [{ t: '💼 Mis cobros', d: 'mine' }, { t: '❓ Cómo funciona', d: 'how' }],
           [{ t: '🇬🇧 English', d: 'en' }]],
    how:
      `<b>Cómo funciona</b>\n\n` +
      `<b>1.</b> Guardá tu billetera de Celo (MiniPay, Valora o MetaMask):\n<code>/billetera 0xTuDireccion</code>\n\n` +
      `<b>2.</b> Mandá un precio: producto, precio y lugar.\n<code>leche 1450 coto palermo</code>\n<code>pan 2800 panadería la esquina</code>\n\n` +
      `<b>3.</b> Si otra persona (otra cuenta y otra billetera) reporta ±${RULES.agreePct * 100}% en ${RULES.windowHours} h, el precio queda confirmado y <b>les pagamos a los dos</b>.\n\n` +
      `🔒 Reglas: máx. ${RULES.perUserDaily} cobros por persona por día · tope diario del agente ${RULES.dailyBudgetWars} wARS · todo pago es público en la blockchain.`,
    noWallet: 'Primero guardá tu billetera:\n<code>/billetera 0xTuDireccion</code>',
    walletSaved: (a) => `✅ <b>Billetera guardada</b>\n<code>${a}</code>\n\nAhora mandá un precio, por ejemplo:\n<code>leche 1450 coto</code>`,
    walletHelp: 'Mandá tu dirección así:\n<code>/billetera 0x...</code>',
    notUnderstood: '🤔 No entendí. Probá así: <code>leche 1450 coto</code>',
    received: (p, price, reward) => `📝 <b>Recibido</b>: ${p} a ${ars(price)}\nCuando otra persona confirme un precio parecido, cobrás <b>${reward} wARS</b>.`,
    confirmed: (p, price) => `✅ <b>Confirmado</b>: ${p} a ${ars(price)}\n¡Otra persona vio lo mismo! Te pagamos en un momento.`,
    outlier: (m) => `⚠️ Ese precio está muy lejos de lo que reporta la gente (mediana ~${ars(m)}). ¿Lo revisás?`,
    paid: (n, h) => `💸 <b>Te pagamos ${n} wARS</b> por precios confirmados.\n${txLink(h)}`,
    noIndex: 'Todavía no hay precios confirmados hoy. ¡Sé de los primeros en reportar! 💪',
    basketTitle: '🧺 <b>Canasta de Índice</b> (último precio confirmado)',
    mine: (r, c, e) => `💼 <b>Tus números</b>\nReportes: ${r}\nConfirmados: ${c}\nCobrado: <b>${e} wARS</b>`,
    web: '🌐 Ver la web',
  },
  en: {
    welcome: (n) =>
      `<b>Hi ${n}! Welcome to Índice</b> 🇦🇷\n\n` +
      `Argentina's inflation, <b>every day</b>, made by people.\n\n` +
      `💬 You send prices you see in your neighbourhood.\n` +
      `🤝 When another person confirms a similar price, it's validated.\n` +
      `💸 You earn <b>${RULES.rewardWars} wARS</b> (digital Argentine pesos on Celo) for every confirmed price.`,
    menu: [[{ t: "📊 Today's index", d: 'idx' }, { t: '🧺 Basket', d: 'basket' }],
           [{ t: '💼 My earnings', d: 'mine' }, { t: '❓ How it works', d: 'how' }],
           [{ t: '🇦🇷 Español', d: 'es' }]],
    how:
      `<b>How it works</b>\n\n` +
      `<b>1.</b> Save your Celo wallet (MiniPay, Valora or MetaMask):\n<code>/billetera 0xYourAddress</code>  (billetera = wallet)\n\n` +
      `<b>2.</b> Send a price: product, price, place.\n<code>leche 1450 coto</code>  (leche = milk)\n<code>pan 2800 la esquina</code>  (pan = bread)\n\n` +
      `<b>3.</b> If another person (different account and wallet) reports within ±${RULES.agreePct * 100}% in ${RULES.windowHours} h, the price is confirmed and <b>you both get paid</b>.\n\n` +
      `🔒 Rules: max ${RULES.perUserDaily} paid reports per person per day · agent daily cap ${RULES.dailyBudgetWars} wARS · every payment is public on-chain.`,
    noWallet: 'First save your wallet:\n<code>/billetera 0xYourAddress</code>',
    walletSaved: (a) => `✅ <b>Wallet saved</b>\n<code>${a}</code>\n\nNow send a price, for example:\n<code>leche 1450 coto</code>  (milk, 1450 pesos, Coto supermarket)`,
    walletHelp: 'Send your address like this:\n<code>/billetera 0x...</code>',
    notUnderstood: "🤔 I didn't get that. Try: <code>leche 1450 coto</code>",
    received: (p, price, reward) => `📝 <b>Received</b>: ${p} at ${ars(price)}\nWhen another person confirms a similar price, you earn <b>${reward} wARS</b>.`,
    confirmed: (p, price) => `✅ <b>Confirmed</b>: ${p} at ${ars(price)}\nSomeone else saw the same price! Paying you now.`,
    outlier: (m) => `⚠️ That price is far from what people report (median ~${ars(m)}). Can you check it?`,
    paid: (n, h) => `💸 <b>We paid you ${n} wARS</b> for confirmed prices.\n${txLink(h, 'en')}`,
    noIndex: 'No confirmed prices yet today. Be one of the first to report! 💪',
    basketTitle: '🧺 <b>Índice basket</b> (last confirmed price)',
    mine: (r, c, e) => `💼 <b>Your numbers</b>\nReports: ${r}\nConfirmed: ${c}\nEarned: <b>${e} wARS</b>`,
    web: '🌐 Open the website',
  },
};

const kb = (lang) => {
  const rows = T[lang].menu.map((row) => row.map((b) => ({ text: b.t, callback_data: b.d })));
  if (WEB.startsWith('https://')) rows.push([{ text: T[lang].web, url: WEB }]);
  return rows;
};
const back = (lang) => [[{ text: lang === 'en' ? '⬅️ Menu' : '⬅️ Menú', callback_data: 'menu' }]];

async function indexCard(lang) {
  const ix = computeIndex(); const off = await official();
  if (!ix.latest) return T[lang].noIndex + `\n\n🏛 INDEC: <b>${off.monthlyPct ?? '?'}%</b> ${lang === 'en' ? 'monthly' : 'mensual'} (${(off.month || '').slice(0, 7)}) · ${off.yearlyPct ?? '?'}% ${lang === 'en' ? 'yearly' : 'anual'}`;
  const ch = ix.dailyChangePct;
  const arrow = ch === null ? '' : ch > 0 ? `🔺 +${ch}%` : ch < 0 ? `🔻 ${ch}%` : '➖ 0%';
  const cov = ix.latest.coverage, total = ix.basket.length;
  const bar = '▰'.repeat(cov) + '▱'.repeat(total - cov);
  return lang === 'en'
    ? `📊 <b>Índice · ${ix.latest.day}</b>\n\n<b>${ix.latest.level}</b> ${arrow}\n<i>base 100 = first confirmed prices</i>\n\nCoverage ${bar} ${cov}/${total}\nConfirmed prices: ${ix.confirmedReports}\n\n🏛 Official INDEC: <b>${off.monthlyPct ?? '?'}%</b> monthly (${(off.month || '').slice(0, 7)}), published weeks later.`
    : `📊 <b>Índice · ${ix.latest.day}</b>\n\n<b>${ix.latest.level}</b> ${arrow}\n<i>base 100 = primeros precios confirmados</i>\n\nCobertura ${bar} ${cov}/${total}\nPrecios confirmados: ${ix.confirmedReports}\n\n🏛 Oficial INDEC: <b>${off.monthlyPct ?? '?'}%</b> mensual (${(off.month || '').slice(0, 7)}), publicado semanas después.`;
}

function basketCard(lang) {
  const ix = computeIndex();
  const lines = ix.basket.map((p) => `• ${p.name}: ${p.lastPrice ? '<b>' + ars(p.lastPrice) + '</b>' : '—'}  <code>${BASKET.find((b) => b.id === p.id).aliases[0]}</code>`);
  return `${T[lang].basketTitle}\n\n${lines.join('\n')}`;
}

function mineCard(tgId, lang) {
  const db = load(); const mine = db.reports.filter((r) => r.tgId === tgId);
  const earned = mine.filter((r) => r.paid).length * RULES.rewardWars;
  const txs = [...new Set(mine.filter((r) => r.payTx).map((r) => r.payTx))].slice(-3).map((h) => '\n' + txLink(h, lang)).join('');
  return T[lang].mine(mine.length, mine.filter((r) => r.confirmed).length, earned) + txs;
}

async function screen(chatId, tgId, key, lang) {
  if (key === 'idx') return send(chatId, await indexCard(lang), back(lang));
  if (key === 'basket') return send(chatId, basketCard(lang), back(lang));
  if (key === 'mine') return send(chatId, mineCard(tgId, lang), back(lang));
  if (key === 'how') return send(chatId, T[lang].how, back(lang));
  return send(chatId, T[lang].welcome(''), kb(lang));
}

// ---------- handlers ----------
async function onCallback(q) {
  const chatId = q.message.chat.id, tgId = String(q.from.id), name = q.from.first_name || '';
  call('answerCallbackQuery', { callback_query_id: q.id });
  if (q.data === 'en' || q.data === 'es') { setLang(tgId, name, q.data); return sendBanner(chatId, T[q.data].welcome(name), kb(q.data)); }
  const lang = langOf(tgId);
  if (q.data === 'menu') return send(chatId, T[lang].welcome(name), kb(lang));
  return screen(chatId, tgId, q.data, lang);
}

async function onMessage(msg) {
  const chatId = msg.chat.id, tgId = String(msg.from.id), name = msg.from.first_name || '';
  const text = (msg.text || '').trim();
  if (!text) return;
  const [cmd, ...rest] = text.split(/\s+/);
  const c = cmd.toLowerCase().replace(/@.*$/, '');
  let lang = langOf(tgId);

  if (c === '/english' || c === '/help') { setLang(tgId, name, 'en'); return sendBanner(chatId, T.en.welcome(name), kb('en')); }
  if (c === '/espanol' || c === '/español') { setLang(tgId, name, 'es'); return sendBanner(chatId, T.es.welcome(name), kb('es')); }
  if (c === '/start' || c === '/ayuda' || c === '/menu') return sendBanner(chatId, T[lang].welcome(name), kb(lang));
  if (c === '/indice') return screen(chatId, tgId, 'idx', lang);
  if (c === '/productos' || c === '/canasta') return screen(chatId, tgId, 'basket', lang);
  if (c === '/mis') return screen(chatId, tgId, 'mine', lang);
  if (c === '/como') return screen(chatId, tgId, 'how', lang);

  if (c === '/billetera' || c === '/wallet') {
    const a = rest[0];
    if (!a || !isAddress(a)) return send(chatId, T[lang].walletHelp);
    const db = load(); db.users[tgId] = { ...(db.users[tgId] || { since: Date.now() }), name, wallet: getAddress(a) }; save(db);
    return send(chatId, T[lang].walletSaved(getAddress(a)));
  }

  const rep = parseReport(text.replace(/^\/precio\s+/i, ''));
  if (!rep) return send(chatId, T[lang].notUnderstood, back(lang));
  const res = await addReport({ tgId, name, ...rep });
  if (res.error === 'no_wallet') return send(chatId, T[lang].noWallet);
  if (res.error === 'outlier') return send(chatId, T[lang].outlier(res.median));
  await send(chatId, res.report.confirmed ? T[lang].confirmed(res.productName, rep.price) : T[lang].received(res.productName, rep.price, RULES.rewardWars));
  await runPayouts();
}

let paying = false;
export async function runPayouts() {
  if (paying) return; paying = true;
  try {
    for (const p of await payConfirmed()) {
      if (p.error) { console.log('payout skipped:', p); continue; }
      console.log('paid', p.amountWars, 'wARS to', p.to, p.tx);
      for (const id of p.tgIds) await send(id, T[langOf(id)].paid(p.amountWars, p.tx));
    }
  } catch (e) { console.error('payout error:', e.shortMessage || e.message); }
  finally { paying = false; }
}

// Bot profile: name, descriptions and the "/" command menu, in Spanish and English.
async function setupProfile() {
  await call('setMyName', { name: 'Índice' });
  await call('setMyDescription', { description:
    'La inflación de Argentina, todos los días, hecha por la gente.\n\nMandá precios que ves en tu barrio y cobrá pesos digitales (wARS) en Celo por cada precio confirmado por otra persona.\n\nToca INICIAR para empezar.' });
  await call('setMyDescription', { language_code: 'en', description:
    "Argentina's inflation, every day, made by people.\n\nSend prices you see and earn digital pesos (wARS) on Celo for every price another person confirms.\n\nTap START to begin." });
  await call('setMyShortDescription', { short_description: 'Inflación diaria de Argentina, hecha por la gente. Cobrá wARS en Celo por cada precio confirmado.' });
  await call('setMyShortDescription', { language_code: 'en', short_description: "Argentina's daily inflation, made by people. Earn wARS on Celo for every confirmed price." });
  await call('setMyCommands', { commands: [
    { command: 'start', description: 'Menú principal' },
    { command: 'indice', description: 'Índice de hoy' },
    { command: 'canasta', description: 'Precios de la canasta' },
    { command: 'billetera', description: 'Guardar tu billetera de Celo' },
    { command: 'mis', description: 'Tus reportes y cobros' },
    { command: 'como', description: 'Cómo funciona' },
    { command: 'english', description: 'English' },
  ] });
  await call('setMyCommands', { language_code: 'en', commands: [
    { command: 'start', description: 'Main menu' },
    { command: 'indice', description: "Today's index" },
    { command: 'canasta', description: 'Basket prices' },
    { command: 'billetera', description: 'Save your Celo wallet' },
    { command: 'mis', description: 'Your reports and earnings' },
    { command: 'como', description: 'How it works' },
    { command: 'espanol', description: 'Español' },
  ] });
}

export async function startBot() {
  if (!TOKEN) { console.log('TELEGRAM_BOT_TOKEN missing: bot not started'); return; }
  await setupProfile().catch(() => {});
  let offset = 0;
  console.log('Telegram bot polling…');
  for (;;) {
    try {
      const r = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(40000) });
      const { result = [] } = await r.json();
      for (const u of result) {
        offset = u.update_id + 1;
        if (u.message) await onMessage(u.message).catch((e) => console.error(e));
        if (u.callback_query) await onCallback(u.callback_query).catch((e) => console.error(e));
      }
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
}
