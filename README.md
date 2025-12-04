# Assup

Asset allocation manager for personal investment portfolios with Interactive Brokers integration.

## Features

- **IBKR Integration** - Connects to Interactive Brokers TWS to download trades and positions
- **Portfolio Grouping** - Groups positions by user-defined asset classes
- **Rebalancing** - Calculates current vs target allocations to determine adjustments
- **Options Scanner** - Find options opportunities for underinvested asset classes

## Tech Stack

- **Backend:** Node.js, TypeScript, Express
- **Frontend:** React, Vite, TypeScript, shadcn/ui, Tailwind CSS
- **Database:** PostgreSQL with Prisma ORM
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

3. Run database migrations and seed:
   ```bash
   docker-compose exec backend npx prisma migrate deploy
   docker-compose exec backend npm run db:seed
   ```

4. Access the application:
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3000

## Local Development

**Start PostgreSQL:**
```bash
docker-compose up -d postgres
```

**Backend:**
```bash
cd backend
npm install
cp .env.example .env
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

## Documentation

- [DESIGN.md](./DESIGN.md) - System design and architecture
- [ROADMAP.md](./ROADMAP.md) - Implementation roadmap
- [CLAUDE.md](./CLAUDE.md) - Project context for AI assistants
