// Captures the README screenshots against a frontend dev server with every API call
// answered from fictional fixtures (./fixtures.mjs). The real backend is never contacted.
//
//   npm run dev --workspace=frontend -- --port 5199 --strictPort   # in another terminal
//   node scripts/screenshots/capture.mjs [dashboard positions ticker spreads wheel]
//
// Env: FRONTEND_URL (default http://localhost:5199), OUT (default docs/images/), SCHEME (light|dark), SCALE (default 1)
import { chromium } from 'playwright';
import { routes, spxChain, spxExpirations, SPX, analyze, sparklines, profileBatch } from './fixtures.mjs';

const OUT = process.env.OUT || new URL('../../docs/images/', import.meta.url).pathname;
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5199';
const only = process.argv.slice(2);

const shots = [
  { name: 'dashboard', path: '/dashboard', wait: 2500, fullPage: true },
  { name: 'positions', path: '/positions', wait: 2000, fullPage: true },
  { name: 'ticker', path: '/tickers/NVDA', wait: 12000, fullPage: true },
  { name: 'spreads', path: '/spreads', wait: 4000, fullPage: true, act: async (pg) => { await pg.getByRole('button', { name: 'Iron Condor', exact: true }).click(); await pg.getByText('Open Options Builder').click(); await pg.waitForTimeout(2000); await pg.getByRole('button', { name: /Oct 30/ }).click(); await pg.waitForTimeout(3000); } },
  { name: 'wheel', path: '/wheel', wait: 2000, fullPage: true },
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.SCALE || 1), colorScheme: process.env.SCHEME || 'light' });
await ctx.addInitScript(() => {
  window.__ASSUP_API_URL__ = 'http://demo.invalid';
  // Persistent fake EventSource: pulls its messages as a JSON array from the mocked origin and stays open.
  window.EventSource = class {
    constructor(url) {
      this.url = url; this.readyState = 0;
      setTimeout(async () => {
        this.readyState = 1; this.onopen && this.onopen({});
        const msgs = await (await fetch(url, { headers: { 'x-fake-sse': '1' } })).json();
        for (const m of msgs) this.onmessage && this.onmessage({ data: JSON.stringify(m) });
      }, 50);
    }
    addEventListener() {} removeEventListener() {} close() { this.readyState = 2; }
  };
});
// Hard block on the real backend: nothing real can ever reach the page.
await ctx.route(/localhost:(3000|3001)/, (r) => r.abort());

const missing = new Set();
await ctx.route('http://demo.invalid/**', async (r) => {
  const req = r.request();
  const u = new URL(req.url());
  const key = `${req.method()} ${u.pathname}`;
  if (u.pathname === '/api/updates/stream') {
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ type: 'connected', clientId: 'demo' }, { type: 'connection', data: { connected: true, host: '127.0.0.1', port: 7496 } }]) });
  }
  if (u.pathname === '/api/spreads/stream') {
    const exp = u.searchParams.get('expiration') || spxExpirations[6];
    const init = { type: 'init', data: { underlyingPrice: SPX, expirations: spxExpirations, selectedExpiration: exp, chain: spxChain(exp), scouting: false } };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([init]) });
  }
  if (key === 'POST /api/iron-condor/analyze' || key === 'POST /api/spreads/analyze') {
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(analyze(req.postDataJSON())) });
  }
  if (key === 'POST /api/historical/sparklines') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sparklines(req.postDataJSON().symbols)) });
  if (key === 'POST /api/ticker-profile/batch') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profileBatch(req.postDataJSON().symbols)) });
  const tp = u.pathname.match(/^\/api\/ticker-profile\/([A-Z.]+)$/);
  if (tp && !(key in routes)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profileBatch([tp[1]])[tp[1]]) });
  if (key in routes) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(routes[key]) });
  missing.add(key + u.search);
  return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
});

for (const s of shots) {
  if (only.length && !only.includes(s.name)) continue;
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log(`  [${s.name}] pageerror: ${e.message}`));
  await pg.goto(FRONTEND + s.path);
  await pg.waitForTimeout(s.wait);
  if (s.act) { await s.act(pg); await pg.waitForTimeout(1500); }
  await pg.screenshot({ path: `${OUT}${s.name}.png`, fullPage: s.fullPage });
  console.log(`${s.name}: missing=${[...missing].join(', ') || 'none'}`);
  missing.clear();
  await pg.close();
}
await b.close();
