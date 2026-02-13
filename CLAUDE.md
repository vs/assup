# Assup Project Context

## Project Overview
**Assup** is an asset allocation management system that integrates with Interactive Brokers TWS to provide portfolio tracking, rebalancing guidance, and options opportunity discovery. The system enables users to define custom asset classes, assign securities to those classes, monitor allocation status, and identify investment opportunities through options analysis.

### Core Features
- **Asset Class Management:** Create and manage custom asset classes (e.g., "Stocks: Tech", "Bonds: US", "Metals") to organize portfolios according to investment strategy.
- **Asset Allocation:** Define target portfolio distribution across asset classes with validation that percentages sum to 100%. Support for multiple allocation profiles.
- **Security Assignment:** Assign any security to an asset class from the positions or watchlist views.
- **IBKR Integration:** Connects to Interactive Brokers TWS to fetch positions, account data, and market information.
- **Allocation Dashboard:** View current vs. target allocation with options exposure columns (notional and delta-weighted). Identify underinvested and overinvested asset classes.
- **Watchlist Management:** Maintain lists of securities for monitoring with inline asset class assignment, TradingView chart integration, and scanner shortcuts.
- **Orders Impact Analysis:** Simulate orders to see how execution would affect portfolio allocation before placing trades. Order confirmation from TWS.
- **Options Scanner:** Find PUT/CALL options for underinvested asset classes based on configurable criteria (expiration, delta, annualized return, premium percentage). Place orders directly from scanner. External research links (TradingView, Seeking Alpha).
- **Profit Tracking:** Import IBKR FLEX reports to track realized P&L from options and stock trades, dividends, interest, and withholding tax. Supports partial fill aggregation and cost basis from IBKR.
- **Real-time Updates:** Server-sent events (SSE) for live position and allocation updates.

## Architecture & Tech Stack
- **Backend:** Node.js with TypeScript, Express
- **Frontend:** Vite + React 19 (TypeScript), shadcn/ui, Tailwind CSS v4
- **Database:** PostgreSQL 16 with Prisma ORM
- **IBKR API:** `@stoqey/ib` library for TWS connectivity
- **Containerization:** Docker & Docker Compose
- **Monorepo:** npm workspaces with shared types in `packages/shared`

## Directory Structure
```
├── backend/           # Express API server
│   ├── prisma/        # Database schema and migrations
│   └── src/
│       ├── routes/    # API endpoints
│       ├── services/  # Business logic (IBKR, allocation, etc.)
│       └── middleware/
├── frontend/          # React SPA
│   └── src/
│       ├── api/       # API client
│       ├── components/
│       ├── hooks/
│       └── pages/
├── packages/
│   └── shared/        # Shared TypeScript types
└── docker-compose.yml
```

## API Routes
| Route | Description |
|-------|-------------|
| `/api/asset-classes` | Asset class CRUD |
| `/api/allocation-profiles` | Allocation profile management |
| `/api/security-assignments` | Symbol-to-asset-class mappings |
| `/api/positions` | IBKR positions with enrichment |
| `/api/watchlists` | Watchlist management |
| `/api/orders` | Order simulation, impact analysis, and placement |
| `/api/scanner` | Options opportunity scanner with order placement |
| `/api/profit` | Profit tracking, FLEX report import, realized P&L |
| `/api/historical-data` | Historical price data for charts |
| `/api/settings` | User preferences |
| `/api/updates/stream` | SSE endpoint for real-time updates |

## Prerequisites
- **Interactive Brokers TWS** must be installed and running
- **TWS Configuration:**
  - Enable ActiveX and Socket Clients
  - Port: `7497` (Paper Trading) or `7496` (Live)
  - Disable "Read-Only API" if trading is required
  - Add `127.0.0.1` and `host.docker.internal` to Trusted IPs

## Running with Docker

### Paper Trading (default)
```bash
docker-compose up --build
docker-compose exec backend npx prisma migrate deploy
docker-compose exec backend npm run db:seed
```
- Frontend: http://localhost:8080
- Backend: http://localhost:3000

### Live Trading
```bash
docker-compose -f docker-compose.live.yml up --build
```
- Frontend: http://localhost:8081
- Backend: http://localhost:3001

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
export IB_PORT=7497
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

## Database Schema
Key models in Prisma:
- `AssetClass` - User-defined investment categories
- `AllocationProfile` / `AllocationTarget` - Target allocation percentages
- `SecurityAssignment` - Maps symbols to asset classes
- `Watchlist` / `WatchlistItem` - Security watchlists
- `ScannerPreset` - Saved scanner configurations
- `Setting` - Key-value application settings
- `ImportBatch` - Tracks FLEX report imports for deduplication
- `ImportedTrade` - Options and stock trades from FLEX reports (with cost basis, realized P&L)
- `CashTransaction` - Dividends, interest, withholding tax, fees from FLEX reports

## Programming Principles

### Fail Fast and Loud
- **Never silently skip invalid data.** If a record has invalid or missing required fields, fail the entire operation with a clear error message.
- **Never guess or calculate missing values.** If a required field is missing from input data, fail with an error explaining what's missing and how to fix it.
- **Never use fallback defaults for critical data.** If a date can't be parsed, don't default to today's date - throw an error with the invalid value and supported formats.

### Error Messages Must Be Actionable
- Include the actual invalid value in error messages
- List the expected/supported formats
- Suggest how to fix the issue (e.g., "Please reconfigure your FLEX Query to include the TradeDate field")

### Data Import Rules
- Validate that all required columns exist before processing any records
- Fail immediately on the first invalid record - don't continue processing
- Never infer or calculate values that should be explicitly provided in the source data
