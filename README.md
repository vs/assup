# Assup

Asset allocation manager for personal investment portfolios with Interactive Brokers integration.

## Features

- **Dashboard** - View current vs. target allocation with options exposure (notional/delta-weighted)
- **Positions** - View IBKR positions with asset class assignments and filtering
- **Watchlists** - Track securities with TradingView chart integration and scanner shortcuts
- **Order Simulator** - Analyze how trades would impact portfolio allocation
- **Options Scanner** - Find options opportunities with PUT/CALL selection, place orders directly, external research links (TradingView, Seeking Alpha)
- **Profit Tracker** - Import IBKR FLEX reports to track realized P&L, dividends, interest, and withholding tax
- **Asset Classes** - Define custom categories and allocation targets

## Tech Stack

- **Backend:** Node.js, TypeScript, Express, Prisma
- **Frontend:** React 19, Vite, Tailwind CSS v4, shadcn/ui
- **Database:** PostgreSQL 16
- **IBKR API:** `@stoqey/ib`

## Prerequisites

1. **Interactive Brokers TWS** must be installed and running
2. **TWS Configuration:**
   - Enable ActiveX and Socket Clients
   - Port: `7497` (Paper Trading) or `7496` (Live)
   - Disable "Read-Only API" if trading is required
   - Add `host.docker.internal` to Trusted IPs

## Docker Deployment

1. Start TWS and log in

2. Build and run:
   ```bash
   docker-compose up --build
   ```

3. Run database migrations and seed:
   ```bash
   docker-compose exec backend npx prisma migrate deploy
   docker-compose exec backend npm run db:seed
   ```

4. Access the application:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000

### Live Trading

For live trading, use the dedicated compose file:
```bash
docker-compose -f docker-compose.live.yml up --build
```
- Frontend: http://localhost:8081
- Backend API: http://localhost:3001

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
