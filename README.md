# Assup

Asset allocation manager for personal investment portfolios with Interactive Brokers integration.

## Features

- **IBKR Integration** - Connects to Interactive Brokers TWS to download trades and positions
- **Portfolio Grouping** - Groups positions by user-defined asset classes
- **Rebalancing** - Calculates current vs target allocations to determine adjustments

## Tech Stack

- **Backend:** Node.js, TypeScript, Express
- **Frontend:** React, Vite, TypeScript, shadcn/ui, Tailwind CSS
- **API:** Interactive Brokers API (via `ib-tws-api`)

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

3. Access the application:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000

## Local Development

**Backend:**
```bash
cd backend
npm install
export IB_HOST=127.0.0.1
export IB_PORT=7497
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
