// Web: a public dashboard ("glass walls" books) + the index API.
// GET /api/index is paid per call in wARS through Celo's x402 facilitator.
import express from 'express';
import { getAddress } from 'viem';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { computeIndex, official, treasury, RULES } from './agent.js';
import { load, save } from './store.js';
import { account, TOKENS } from './chain.js';

export const PRICE_WARS = Number(process.env.INDEX_PRICE_WARS || 100);

function paidRoutes() {
  const facilitator = new HTTPFacilitatorClient({
    url: 'https://api.x402.celo.org',
    createAuthHeaders: async () => { const h = { 'X-API-Key': process.env.X402_API_KEY }; return { verify: h, settle: h, supported: h }; },
  });
  const server = new x402ResourceServer(facilitator);
  server.register('eip155:*', new ExactEvmScheme());
  const routes = {
    'GET /api/index': {
      accepts: [{
        scheme: 'exact', network: 'eip155:42220', payTo: getAddress(account.address),
        price: { amount: (BigInt(PRICE_WARS) * 10n ** 18n).toString(), asset: getAddress(TOKENS.wARS.address),
          extra: { name: 'Peso Argentino', version: '1', assetTransferMethod: 'permit2' } },
      }],
      description: `Índice: Argentina daily crowd-sourced inflation index (${PRICE_WARS} wARS per call)`,
      mimeType: 'application/json',
      extensions: { eip2612GasSponsoring: { info: { description: 'The facilitator sponsors the EIP-2612 permit to Permit2.', version: '1' } } },
    },
  };
  return paymentMiddleware(routes, server);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function startServer(port = Number(process.env.PORT || 8787)) {
  const app = express();
  app.use('/assets', express.static('assets', { maxAge: '1d' }));

  if (process.env.X402_API_KEY) app.use(paidRoutes());
  else app.get('/api/index', (_q, res) => res.status(503).json({ error: 'x402 not configured (X402_API_KEY missing)' }));

  app.get('/api/index', (req, res) => {
    const db = load();
    db.sales.push({ ts: Date.now(), amountWars: PRICE_WARS, paymentHeader: Boolean(req.headers['payment-signature'] || req.headers['x-payment']) });
    save(db);
    res.json(computeIndex());
  });

  // Free teaser so anyone can see the index exists.
  app.get('/api/summary', async (_q, res) => {
    const ix = computeIndex();
    res.json({ latest: ix.latest, dailyChangePct: ix.dailyChangePct, confirmedReports: ix.confirmedReports, official: await official(), fullIndex: `/api/index (x402, ${PRICE_WARS} wARS)` });
  });

  // Public books: every peso in and out.
  app.get('/api/books', async (_q, res) => {
    const db = load();
    res.json({ treasury: await treasury(), rules: RULES, payouts: db.payouts, sales: db.sales.length });
  });

  app.get('/', async (_q, res) => {
    const ix = computeIndex(); const off = await official(); const db = load();
    let tre = { wARS: '?', USDT: '?' }; try { tre = await treasury(); } catch {}
    const rows = ix.basket.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.lastPrice ? '$' + Math.round(p.lastPrice).toLocaleString('es-AR') : '-'}</td></tr>`).join('');
    const pays = db.payouts.slice(-15).reverse().map((p) => `<tr><td>${new Date(p.ts).toISOString().slice(0, 16).replace('T', ' ')}</td><td>${p.amountWars} wARS</td><td><a href="https://celoscan.io/tx/${p.tx}">${p.tx.slice(0, 10)}…</a></td></tr>`).join('') || '<tr><td colspan="3">Todavía no hay pagos.</td></tr>';
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Índice</title><link rel="icon" href="/assets/logo-512.png"><meta property="og:image" content="/assets/banner.png"><meta name="description" content="Argentina's inflation number, every day, made by people who get paid in pesos (wARS) on Celo."><style>
:root{--bg:#f6f4ee;--fg:#1b1b1b;--muted:#666;--card:#fff;--line:#e3dfd3;--accent:#2f6f4f}
@media (prefers-color-scheme:dark){:root{--bg:#121412;--fg:#ecece6;--muted:#9a9a92;--card:#1b1e1b;--line:#2b2f2b;--accent:#7fd1a2}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:820px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0}h1{margin:0}.big{font-size:44px;font-weight:700;color:var(--accent)}
.muted{color:var(--muted)}table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid var(--line)}a{color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}code{background:var(--line);padding:2px 6px;border-radius:6px}</style></head>
<body><main><div style="display:flex;align-items:center;gap:14px"><img src="/assets/logo-512.png" alt="" width="56" height="56" style="border-radius:50%"><h1>Índice</h1></div>
<p class="muted">La inflación de Argentina, todos los días, hecha por la gente. Cada precio confirmado se paga en pesos (wARS) en Celo.<br><i>Argentina's inflation, every day, made by people. Every confirmed price is paid in pesos (wARS) on Celo.</i></p>
<p><a href="https://t.me/IndiceDiarioBot"><b>Reportá precios en Telegram → @IndiceDiarioBot</b></a></p>
<div class="grid"><div class="card"><div class="muted">Índice (base 100)</div><div class="big">${ix.latest ? ix.latest.level : '-'}</div>
<div class="muted">${ix.latest ? `${ix.latest.day} · ${ix.latest.coverage}/${ix.basket.length} productos` : 'Esperando precios confirmados'}${ix.dailyChangePct !== null ? ` · ${ix.dailyChangePct >= 0 ? '+' : ''}${ix.dailyChangePct}% vs ayer` : ''}</div></div>
<div class="card"><div class="muted">Oficial INDEC (vía BCRA)</div><div class="big">${off.monthlyPct ?? '-'}%</div><div class="muted">mensual (${esc(off.month || '')}) · ${off.yearlyPct ?? '-'}% anual. Publicado con semanas de atraso.</div></div></div>
<div class="card"><b>Canasta</b> (último precio confirmado)<table>${rows}</table></div>
<div class="card"><b>Libros públicos</b>: tesorería <code>${account.address}</code><br>Saldo: ${tre.wARS} wARS · ${tre.USDT} USD₮ · Pagado a reporteros: ${ix.paidOutWars} wARS · Reportes: ${ix.totalReports} (${ix.confirmedReports} confirmados) · Ventas del índice: ${db.sales.length}
<table>${pays}</table></div>
<div class="card"><b>Reglas del agente</b>: ${RULES.rewardWars} wARS por precio confirmado · confirma solo si otra persona (otra cuenta y otra billetera) reporta ±${RULES.agreePct * 100}% en ${RULES.windowHours} h · tope diario ${RULES.dailyBudgetWars} wARS · máx. ${RULES.perUserDaily} pagos por persona por día.</div>
<div class="card"><b>Para agentes y apps</b>: <code>GET /api/index</code>, ${PRICE_WARS} wARS por consulta vía x402 (facilitador de Celo). Resumen gratis: <a href="/api/summary">/api/summary</a> · Libros: <a href="/api/books">/api/books</a> · ERC-8004 agentId 10062</div>
</main></body></html>`);
  });

  app.listen(port, (err) => {
    if (err) { console.error(`Cannot start web on port ${port}: ${err.message}`); process.exit(1); }
    console.log(`Web on http://localhost:${port} (x402 ${process.env.X402_API_KEY ? 'on' : 'off'})`);
  });
}
