# Assup

Asset allocation manager for personal investment portfolios with Interactive Brokers integration.

## Features

- **Dashboard** — Profit analytics with MTD/YTD/Annual/All-time periods, strategy-based P&L breakdown, projected P&L from short options, pace metrics, and cumulative charts
- **Positions** — IBKR positions with asset class grouping, options exposure (notional/delta-weighted), unrealized P&L, and allocation tracking
- **Watchlists** — Track securities with TradingView chart integration and scanner shortcuts
- **Options Scanner** — Find PUT/CALL opportunities for underinvested asset classes, background scanning with progress tracking, direct order placement
- **Spreads / Iron Condors** — Build and manage options spreads on SPX/XSP/RUT with real-time chain streaming, smart delta-based strike selection, active spread detection, and combo order placement
- **Ticker Profiles** — Company intelligence from Polygon.io (sector, market cap, P/E, dividends), real-time IBKR quotes, price charts, and latest research report
- **Profit Tracker** — Import IBKR FLEX reports (XML/CSV) to track realized P&L, dividends, interest, withholding tax, with multi-currency support and deduplication
- **Taxes** — Czech tax compliance with FIFO lot matching, CZK conversion via CNB rates, 3-year and 100k CZK exemption tracking, income basket separation, CSV export
- **Wheel Strategy** — Track wheel positions with trade history, P&L summaries, auto-suggestions, and precomputed caching
- **Research** — AI-powered stock research with 12+ data collectors, 9+ analyzers, and Claude-synthesized reports with BUY/HOLD/SELL recommendations
- **Market Scanner** — TWS stock scanner integration with technical filters (SMA, RSI), preset scheduling, and auto-ticker discovery
- **Live Macro** — Real-time VIX/SPX streaming with fear/greed regime classification via SSE
- **Asset Classes** — Define custom categories and allocation targets with multiple profiles
- **Desktop App** — Native desktop wrapper via Tauri

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, TypeScript, Express, Prisma |
| Frontend | React 19, Vite, Tailwind CSS v4, shadcn/ui |
| Database | PostgreSQL 16 |
| Research | Integrated in backend, Polygon.io, Anthropic Claude |
| IBKR API | `@stoqey/ib` |
| Desktop | Tauri (Rust) |
| Monorepo | npm workspaces (`packages/shared`, `backend`, `frontend`, `desktop`) |

## Prerequisites

1. **Interactive Brokers TWS** must be installed and running
2. **TWS Configuration:**
   - Enable ActiveX and Socket Clients
   - Port: `7496`
   - Disable "Read-Only API" if trading is required
   - Add `host.docker.internal` to Trusted IPs (for Docker)

See [IBKR.md](IBKR.md) for detailed IBKR setup including FLEX Query configuration.

## Docker Deployment

1. Create required external volumes (first time only):
   ```bash
   docker volume create assup-postgres-data
   ```

2. Start TWS and log in

3. Build and run:
   ```bash
   docker-compose up --build
   ```

4. Run database migrations and seed:
   ```bash
   docker-compose exec backend npx prisma migrate deploy
   docker-compose exec backend npm run db:seed
   ```

5. Access the application:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000

### Development Mode

For hot-reload during development:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Frontend dev server runs on http://localhost:5173 with HMR.

## Local Development

**Start PostgreSQL:**
```bash
docker-compose up -d postgres
```

**Backend:**
```bash
cd backend
npm install
export DATABASE_URL="postgresql://assup:assup_dev@localhost:5432/assup"
export IB_HOST=127.0.0.1
export IB_PORT=7496
export ANTHROPIC_API_KEY=<your-key>
export MARKET_DATA_API_KEY=<your-polygon-key>
npm run db:migrate
npm run db:seed
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `IB_HOST` | TWS host | `127.0.0.1` |
| `IB_PORT` | TWS API port | `7496` |
| `ANTHROPIC_API_KEY` | Claude API key for report synthesis | — |
| `MARKET_DATA_API_KEY` | Polygon.io API key | — |
| `MARKET_DATA_PROVIDER` | Market data provider | `polygon` |
| `SYNTHESIZER_MODE` | `api` or `cli` for report synthesis | `api` |
| `SCHEDULER_ENABLED` | Enable research scheduler | `false` |
