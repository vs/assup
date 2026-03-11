# Assup

Asset allocation manager for personal investment portfolios with Interactive Brokers integration.

## Features

- **Dashboard** — Current vs. target allocation with options exposure (notional/delta-weighted)
- **Positions** — IBKR positions with asset class assignments and filtering
- **Watchlists** — Track securities with TradingView chart integration and scanner shortcuts
- **Options Scanner** — Find options opportunities, place orders directly, external research links
- **Profit Tracker** — Import IBKR FLEX reports to track realized P&L, dividends, interest, and withholding tax
- **Taxes** — Czech tax compliance with FIFO lot matching, CZK conversion via CNB rates, 3-year and 100k CZK exemption tracking
- **Wheel Strategy** — Track and manage wheel strategy positions across symbols
- **Research** — AI-powered stock research with multi-source data collection, analysis, and report synthesis
- **Asset Classes** — Define custom categories and allocation targets with multiple profiles
- **Desktop App** — Native desktop wrapper via Tauri

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, TypeScript, Express, Prisma |
| Frontend | React 19, Vite, Tailwind CSS v4, shadcn/ui |
| Database | PostgreSQL 16 |
| Research | Separate Express microservice, Polygon.io, Anthropic Claude |
| IBKR API | `@stoqey/ib` |
| Desktop | Tauri (Rust) |
| Monorepo | npm workspaces (`packages/shared`, `backend`, `frontend`, `research`, `desktop`) |

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
   docker-compose exec research npx prisma migrate deploy
   ```

5. Access the application:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000
   - Research API: http://localhost:3002

### Development Mode

For hot-reload during development:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Frontend dev server runs on http://localhost:5173 with HMR.

## Local Development

**Start PostgreSQL:**
```bash
docker-compose up -d postgres research-db
```

**Backend:**
```bash
cd backend
npm install
export DATABASE_URL="postgresql://assup:assup_dev@localhost:5432/assup"
export IB_HOST=127.0.0.1
export IB_PORT=7496
export RESEARCH_API_URL=http://localhost:3002
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

**Research service:**
```bash
cd research
npm install
export DATABASE_URL="postgresql://research:research_dev@localhost:5433/research"
export ANTHROPIC_API_KEY=<your-key>
export MARKET_DATA_API_KEY=<your-polygon-key>
npm run db:migrate
npm run dev
```

## Environment Variables

### Core (backend)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `IB_HOST` | TWS host | `127.0.0.1` |
| `IB_PORT` | TWS API port | `7496` |
| `RESEARCH_API_URL` | Research service URL | `http://localhost:3002` |

### Research service

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Research PostgreSQL connection string | — |
| `ANTHROPIC_API_KEY` | Claude API key for report synthesis | — |
| `MARKET_DATA_API_KEY` | Polygon.io API key | — |
| `MARKET_DATA_PROVIDER` | Market data provider | `polygon` |
| `SEEKING_ALPHA_API_KEY` | Seeking Alpha API key | — |
