# Assup Project Context

## Project Overview
**Assup** is an asset allocation management system that integrates with Interactive Brokers TWS to provide portfolio tracking, rebalancing guidance, and options opportunity discovery. The system enables users to define custom asset classes, assign securities to those classes, monitor allocation status, and identify investment opportunities through options analysis.

### Core Features
- **Asset Class Management:** Create and manage custom asset classes (e.g., "Stocks: Tech", "Bonds: US", "Metals") to organize portfolios according to investment strategy.
- **Asset Allocation:** Define target portfolio distribution across asset classes with validation that percentages sum to 100%. Support for multiple allocation profiles with active profile selection.
- **Security Assignment:** Assign any security to an asset class from the positions or watchlist views.
- **IBKR Integration:** Connects to Interactive Brokers TWS to fetch positions, account data, and market information.
- **Dashboard:** Profit analytics with multiple period modes (MTD, YTD, Annual, All-time). Strategy-based P&L breakdown (options premiums, spread closures, stock trades, dividends, interest). Projected P&L from open short options. Pace metrics (realized, projected, days remaining). Cumulative chart with current vs. target allocation and options exposure (notional/delta-weighted).
- **Positions:** IBKR positions with asset class grouping, options exposure columns (notional and delta-weighted), unrealized P&L, average cost, and market value. Toggle options inclusion and weight mode.
- **Watchlist Management:** Maintain lists of securities for monitoring with inline asset class assignment, TradingView chart integration, and scanner shortcuts.
- **Options Scanner:** Find PUT/CALL options for underinvested asset classes based on configurable criteria (expiration, delta, annualized return, premium percentage). Background scanner jobs with progress tracking via SSE. Place orders directly from scanner. External research links (TradingView, Seeking Alpha).
- **Spreads / Iron Condor Builder:** Build and manage options spreads (put spreads, call spreads, iron condors) on SPX, XSP, RUT. Real-time options chain streaming via SSE with two-phase smart subscription (scout phase for delta discovery, focus phase for dense subscription around targets). Active spread detection from IBKR positions. Combo order placement and closure. Market data line management (max 100 IBKR lines with reservation system). Configurable symbols, update intervals, and DTE filtering.
- **Ticker Profiles:** Company intelligence from Polygon.io with 7-day caching. Company overview (sector, industry, market cap, P/E, dividend yield), real-time IBKR quotes, historical price charts, and latest research report integration. Batch profile retrieval (up to 50 symbols). Cache statistics monitoring.
- **Profit Tracking:** Import IBKR FLEX reports (XML and CSV) to track realized P&L from options and stock trades, dividends, interest, and withholding tax. Supports partial fill aggregation, cost basis from IBKR, multi-currency support, and file hash deduplication. Corporate action handling (splits, mergers, ticker changes).
- **Tax Reporting:** Czech tax compliance with FIFO lot matching, CZK conversion via CNB daily rates, 3-year holding period exemption, 100k CZK value exemption, income basket separation (securities vs. derivatives), and CSV export for tax returns. Exchange rate prefetch for entire year.
- **Wheel Strategy:** Track wheel strategy positions across symbols with trade history, P&L summaries, suggestion management (auto-detect tickers with recent option activity), suggestion dismissal, and precomputed summary caching.
- **Research Service:** AI-powered stock research with 12+ data collectors (technical analysis, fundamentals, options flow, SEC filings, macro, events, social sentiment, Seeking Alpha ratings/comments) and 9+ analyzers producing signal/confidence scores. Synthesized reports via Anthropic Claude with BUY/HOLD/SELL recommendations. Background async job execution with SSE progress updates.
- **Market Scanner:** TWS built-in stock scanner integration with technical filters (SMA periods, RSI thresholds). Scanner presets with scheduling support. Auto-discovery of tickers with research report queuing. Scan run history persistence.
- **Live Macro Broadcasting:** Real-time VIX and SPX index streaming from IBKR every 5 seconds via SSE. Fear/greed regime classification (risk_on, risk_off, neutral) with confidence scoring. Price change deltas. Adaptive broadcasting (only when clients connected).
- **Order Management:** Open order tracking from IBKR, order enrichment with asset classes, allocation impact simulation, order modification, and live option quotes.
- **Desktop App:** Native desktop wrapper via Tauri for standalone operation.
- **Real-time Updates:** Server-sent events (SSE) for live positions, allocation, macro regime, scanner job progress, and research job status.

## Architecture & Tech Stack
- **Backend:** Node.js with TypeScript, Express. Includes integrated research pipeline with Polygon.io for market data and Anthropic Claude for report synthesis.
- **Frontend:** Vite + React 19 (TypeScript), shadcn/ui, Tailwind CSS v4
- **Database:** PostgreSQL 16 with Prisma ORM
- **IBKR API:** `@stoqey/ib` library for TWS connectivity
- **Desktop:** Tauri (Rust) wrapping the frontend
- **Containerization:** Docker & Docker Compose
- **Monorepo:** npm workspaces with shared types in `packages/shared`

## Directory Structure
```
├── backend/           # Express API server
│   ├── prisma/        # Database schema and migrations
│   └── src/
│       ├── routes/    # API endpoints (20+ route files)
│       ├── services/  # Business logic (IBKR, allocation, import, profit, tax, wheel, research, spreads, etc.)
│       └── middleware/
├── frontend/          # React SPA
│   └── src/
│       ├── api/       # API client (20+ domain-specific files)
│       ├── components/
│       ├── hooks/
│       └── pages/
├── desktop/           # Tauri desktop application
│   └── src-tauri/     # Rust backend
├── packages/
│   └── shared/        # Shared TypeScript types and schemas
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
| `/api/orders` | Order placement and open order tracking |
| `/api/scanner` | Options opportunity scanner with order placement |
| `/api/scanner/jobs` | Background scanner job tracking |
| `/api/profit` | Profit tracking, FLEX report import, realized P&L |
| `/api/exchange-rates` | CNB exchange rate management |
| `/api/taxes` | Tax calculations, lot tracing, CSV export |
| `/api/wheel` | Wheel strategy tracking |
| `/api/research` | Research pipeline (reports, analysis, macro, tickers) |
| `/api/iron-condor` | Iron condor combo order placement |
| `/api/spreads` | Spread position detection and closure |
| `/api/spreads/stream` | SSE endpoint for live options chain data |
| `/api/ticker-profile` | Company profiles, quotes, and cache management |
| `/api/dashboard` | Dashboard summary with profit analytics and projections |
| `/api/wheel-scanner` | Wheel strategy candidate scanner (configs, scans, results) |
| `/api/historical-data` | Historical price data for charts |
| `/api/settings` | User preferences |
| `/api/updates/stream` | SSE endpoint for real-time updates |

## Prerequisites
- **Interactive Brokers TWS** must be installed and running
- **TWS Configuration:**
  - Enable ActiveX and Socket Clients
  - Port: `7496`
  - Disable "Read-Only API" if trading is required
  - Add `127.0.0.1` and `host.docker.internal` to Trusted IPs

## Running with Docker

```bash
docker-compose up --build
docker-compose exec backend npx prisma migrate deploy
docker-compose exec backend npm run db:seed
```
- Frontend: http://localhost:8080
- Backend: http://localhost:3000

### Development Mode

For hot-reload during development:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

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

## Database Schema

### Backend Database
Key models in Prisma:
- `AssetClass` - User-defined investment categories
- `AllocationProfile` / `AllocationTarget` - Target allocation percentages
- `SecurityAssignment` - Maps symbols to asset classes
- `Watchlist` / `WatchlistItem` - Security watchlists
- `ScannerPreset` - Saved scanner configurations
- `ScanJob` - Background scanner execution tracking (status, progress, results)
- `Setting` - Key-value application settings
- `ImportBatch` - Tracks FLEX report imports for deduplication
- `ImportedTrade` - Options and stock trades from FLEX reports (with cost basis, realized P&L)
- `CashTransaction` - Dividends, interest, withholding tax, fees from FLEX reports
- `CorporateAction` - Stock splits, mergers, ticker changes from FLEX reports
- `ExchangeRate` - CNB daily exchange rates for tax calculations
- `WheelTracker` - Tickers tracked for wheel strategy
- `WheelSuggestionDismissal` - Dismissed wheel strategy suggestions
- `WheelSummaryCache` - Precomputed wheel strategy summaries

### Research Models (in main database)
- `ResearchTicker` - Symbols being tracked for research
- `DataCollection` - Raw collected market data per source
- `Analysis` - Analysis results with signal, confidence, and details
- `Report` - Synthesized research reports with recommendations
- `ResearchJob` - Async job tracking for long-running research operations
- `ScreenerConfig` - Stock screener configurations and schedules
- `MacroSnapshot` - Macro regime analysis snapshots

### Ticker & Market Scanner Models
- `TickerProfile` - Company metadata and profile information (Polygon.io)
- `PriceHistoryCache` - Cached sparkline/historical price data
- `MarketScannerPreset` - TWS scanner configurations with filters and schedules
- `ScanRun` - Persisted scanner execution results

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
