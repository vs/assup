<p align="center">
  <img src="frontend/public/assup_logo.svg" alt="Assup" height="72">
</p>

<p align="center">
  <b>Self-hosted portfolio cockpit for Interactive Brokers.</b><br>
  Asset allocation, options income tracking, spread building, AI research and tax reporting — running on your own machine against your own TWS.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white">
  <img alt="Interactive Brokers TWS" src="https://img.shields.io/badge/IBKR-TWS%20API-d71920">
</p>

![Dashboard](docs/images/dashboard.png)

> Screenshots use fictional demo data — see [Regenerating screenshots](#regenerating-screenshots).

## Why Assup?

Interactive Brokers is a great broker with a busy UI. Assup sits next to TWS and answers the questions you actually ask every day:

- *Am I on target?* — define your own asset classes and target allocation, and see drift including option exposure.
- *What am I earning?* — realized and projected P&L across short options, spreads, stock trades, dividends and interest, month by month.
- *What should I sell next?* — scan for puts and calls on underweight asset classes, or build an SPX iron condor from a live, delta-aware chain.
- *What do I owe?* — FIFO lot matching and CZK tax reports straight from your IBKR FLEX exports.

Everything runs locally. Your positions never leave your machine except for the market-data and AI providers you explicitly configure.

## Features

<table>
<tr>
<td width="50%" valign="top">

**📊 Dashboard**<br>
MTD / YTD / annual / all-time P&L by strategy (options, spreads, stocks, dividends & interest, fees), current-month pace and projection from open short options, account-value history, upcoming events, active wheels and spreads.

**💼 Positions & allocation**<br>
IBKR positions grouped by your asset classes, with notional or delta-weighted options exposure, unrealized P&L, 1-month sparklines, and multiple allocation profiles.

**🔁 Wheel strategy**<br>
Per-ticker cycle tracking (CSP → shares → covered call), premiums, adjusted cost basis, dividends, and annualized yield vs. buy-and-hold.

**⚖️ Spreads & iron condors**<br>
Live options chain streaming for SPX / XSP / RUT with delta-targeted strike selection, payoff chart, probability of profit, one-click combo orders, active spread detection, rolls and hedges.

</td>
<td width="50%" valign="top">

**🔎 Options scanner**<br>
Find puts or calls for underinvested asset classes by expiration, delta, annualized return and premium. Runs as background jobs with live progress, and orders can be placed straight from the results.

**🧠 AI research**<br>
12+ collectors (technicals, fundamentals, options flow, SEC filings, macro, earnings, sentiment…) and 9+ analyzers feed a Claude-written report with a Buy / Hold / Sell / Wheel recommendation.

**📅 Calendar & macro**<br>
Earnings, dividends, expirations and macro events; live VIX / S&P fear-greed gauge with GEX levels.

**🧾 Profit & taxes**<br>
FLEX report import (XML/CSV) with deduplication, corporate actions and multi-currency support. Czech tax module: FIFO lots, CNB exchange rates, 3-year and 100k CZK exemptions, CSV export.

</td>
</tr>
</table>

## Screenshots

| Positions | Ticker research |
|---|---|
| ![Positions grouped by asset class with options exposure](docs/images/positions.png) | ![Ticker page with chart, AI recommendation and activity log](docs/images/ticker.png) |

| Iron condor builder | Wheel tracker |
|---|---|
| ![Iron condor builder with live chain and payoff chart](docs/images/spreads.png) | ![Wheel strategy tracker](docs/images/wheel.png) |

## Quick start

### Prerequisites

- **Interactive Brokers TWS** (or IB Gateway), running and logged in
- **Docker** with Docker Compose — or Node.js 22+ and PostgreSQL 16 for a local setup
- Optional API keys for research features (see [Configuration](#configuration))

Configure TWS under *Edit → Global Configuration → API → Settings*:

1. Enable **ActiveX and Socket Clients**
2. Socket port **7496** (live) or **7497** (paper)
3. Untick **Read-Only API** if you want to place orders from Assup
4. Add `127.0.0.1` (and `host.docker.internal` for Docker) to **Trusted IPs**

See [IBKR.md](IBKR.md) for the full setup, including the FLEX Query needed by the profit and tax pages.

### Run with Docker

```bash
git clone https://github.com/vs/assup.git
cd assup
cp .env.example .env                       # fill in any optional keys
docker volume create assup-postgres-data   # first run only
docker compose up --build
```

Then, in a second terminal, initialise the database:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run db:seed
```

Open **http://localhost:8080** (API on http://localhost:3000).

For hot reload during development:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up   # frontend on :5173
```

### Run locally

```bash
npm install                        # installs all workspaces and builds packages/shared
docker compose up -d postgres      # or point DATABASE_URL at your own Postgres 16

cd backend
export DATABASE_URL="postgresql://assup:assup_dev@localhost:5432/assup"
npm run db:migrate && npm run db:seed
npm run dev                        # http://localhost:3000

cd ../frontend
npm run dev                        # http://localhost:5173
```

### Desktop app

A [Tauri](https://tauri.app) wrapper lives in [`desktop/`](desktop). With the Rust toolchain installed:

```bash
npm run dev --workspace=desktop     # development
npm run build --workspace=desktop   # native bundle
```

## Configuration

All settings are environment variables (see [`.env.example`](.env.example)). Only `DATABASE_URL` is required; everything else enables optional features.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `IB_HOST` / `IB_PORT` | TWS / IB Gateway address | `127.0.0.1` / `7496` |
| `IB_CLIENT_ID` | TWS API client id | `1` |
| `IB_MARKET_DATA_LINES` | Market-data line budget shared by streams | `100` |
| `PORT` | Backend HTTP port | `3000` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:8080` |
| `MARKET_DATA_API_KEY` | [Polygon.io](https://polygon.io) key for profiles and research | — |
| `POLYGON_RATE_LIMIT_RPM` | Polygon request budget per minute | `5` (free tier) |
| `MARKET_DATA_PROVIDER` | Research market-data provider | `auto` |
| `FINNHUB_API_KEY` | [Finnhub](https://finnhub.io) key for the earnings calendar | — |
| `SA_RAPIDAPI_KEY` | Seeking Alpha (RapidAPI) ratings and comments | — |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Social sentiment collector | — |
| `SYNTHESIZER_MODE` | Report synthesis via `claude-cli` (Claude Code login) or `api` | `claude-cli` |
| `ANTHROPIC_API_KEY` | Claude API key when `SYNTHESIZER_MODE=api` | — |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code token when `SYNTHESIZER_MODE=claude-cli` | — |
| `SCHEDULER_ENABLED` | Run scheduled research, scans and FLEX auto-import | `false` |

> **Docker note:** `docker-compose.yml` forwards only a subset of these variables to the backend. It pins `IB_PORT=7496` and defaults to `SYNTHESIZER_MODE=api` and `MARKET_DATA_PROVIDER=polygon`. To use anything else, add it under `services.backend.environment`.

## Architecture

```
┌──────────────┐   REST + SSE   ┌──────────────────────┐   socket API   ┌─────────────┐
│  React SPA   │ ─────────────▶ │  Express backend     │ ─────────────▶ │  IBKR TWS   │
│  (Vite, or   │                │  (TypeScript)        │                └─────────────┘
│  Tauri app)  │ ◀───────────── │  services / routes   │ ──▶ Polygon · Finnhub · Claude
└──────────────┘                └──────────┬───────────┘
                                           │ Prisma
                                    ┌──────▼──────┐
                                    │ PostgreSQL  │
                                    └─────────────┘
```

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express, Prisma, [`@stoqey/ib`](https://github.com/stoqey/ib) |
| Frontend | React 19, Vite, Tailwind CSS v4, shadcn/ui, Recharts |
| Database | PostgreSQL 16 |
| Research | Polygon.io, Finnhub, Anthropic Claude |
| Desktop | Tauri 2 (Rust) |
| Monorepo | npm workspaces — `packages/shared`, `backend`, `frontend`, `desktop` |

```
backend/     Express API — routes/, services/ (ibkr, allocation, profit, taxes, wheel, research, spreads…), prisma/
frontend/    React SPA — pages/, components/, api/, hooks/
desktop/     Tauri shell
packages/shared/   Types and schemas shared by backend and frontend
docs/        Guides, design notes and screenshots
```

## Development

```bash
npm run test:run --workspace=assup-backend   # backend tests (Vitest)
npm run lint --workspace=frontend            # frontend lint
npm run build                                # build every workspace
```

Integration tests reset their database. Point them at a dedicated test database, never at the one holding your data.

### Regenerating screenshots

The images in `docs/images/` come from the real frontend, with every API call answered from fictional fixtures. The capture script also blocks the real backend, so no account data can show up.

```bash
npm run dev --workspace=frontend -- --port 5199 --strictPort   # terminal 1
node scripts/screenshots/capture.mjs                           # terminal 2
```

Edit [`scripts/screenshots/fixtures.mjs`](scripts/screenshots/fixtures.mjs) to change the demo portfolio.

## Documentation

- [IBKR.md](IBKR.md): TWS API settings and the FLEX Query used by the profit and tax pages
- [docs/pnl.md](docs/pnl.md): how cost basis, P&L, assignments and Czech tax figures are calculated

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report security issues as described in [SECURITY.md](SECURITY.md).

## Disclaimer

Assup is an independent project and is not affiliated with, endorsed by, or supported by Interactive Brokers. It is not financial or tax advice. It can place **real orders** in your brokerage account. Test against a paper-trading account first, and review every order before submitting it. Tax calculations target Czech rules and must be checked by you or a qualified advisor. The software is provided "as is", without warranty of any kind (see the license).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
