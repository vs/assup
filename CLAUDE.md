# Assup Project Context

## Project Overview
**Assup** is an asset allocation management system that integrates with Interactive Brokers TWS to provide portfolio tracking, rebalancing guidance, and options opportunity discovery. The system enables users to define custom asset classes, assign securities to those classes, monitor allocation status, and identify investment opportunities through options analysis.

### Core Features
*   **Asset Class Management:** Create and manage custom asset classes (e.g., "Stocks: Tech", "Bonds: US", "Metals") to organize portfolios according to investment strategy.
*   **Asset Allocation:** Define target portfolio distribution across asset classes with validation that percentages sum to 100%. Support for multiple allocation profiles.
*   **Security Assignment:** Assign any security to an asset class. Assignments can be made from watchlist or positions view.
*   **IBKR Integration:** Connects to Interactive Brokers TWS locally to download positions, orders, and market data.
*   **Allocation Dashboard:** Visualize current vs. target allocation with pie/bar charts. Identify underinvested and overinvested asset classes. Toggle to include options positions using notional or delta-weighted calculations.
*   **Watchlist Management:** Maintain lists of securities for monitoring with inline asset class assignment.
*   **Orders Impact Analysis:** View open orders and see how execution would affect portfolio allocation.
*   **Options Scanner:** Analyze options market data to find opportunities for underinvested asset classes based on configurable criteria (expiration, delta, annualized return, premium percentage).
*   **Deployment:** Designed to be deployed as a Docker container (Backend + Frontend).

## Architecture & Tech Stack
*   **Backend:** Node.js with TypeScript, Express
*   **Frontend:** Vite + React (TypeScript), shadcn/ui, Tailwind CSS
*   **Database:** PostgreSQL with Prisma ORM
*   **API:** Interactive Brokers API (via `ib-tws-api`)
*   **Containerization:** Docker & Docker Compose

## Asset Allocation Strategy
The project currently targets the following allocation distribution:

| Asset Class | Target Allocation |
| :--- | :--- |
| Bonds: US | 25% |
| Stocks: Tech | 20% |
| Stocks: Nuclear | 10% |
| Stocks: India | 10% |
| Stocks: US | 10% |
| Stocks: ex-US | 5% |
| High Yield | 5% |
| Metals | 5% |
| Pick-up | 5% |
| Cash | 5% |

## Development Status & Setup
**Current State:** The project is initialized with a full-stack structure (backend/frontend) and Docker support, configured to connect to a local TWS instance.

### Directory Structure
- `backend/`: Node.js/Express/TypeScript backend.
- `frontend/`: React/Vite/TypeScript frontend with shadcn/ui.
- `docker-compose.yml`: Orchestrates Backend and Frontend services.

### Prerequisites
*   **Interactive Brokers TWS:** Must be installed and running on the host machine.
*   **TWS Configuration:**
    *   Enable ActiveX and Socket Clients.
    *   Port: `7497` (Paper Trading) or `7496` (Live).
    *   Disable "Read-Only API" if trading/rebalancing is required.
    *   Trusted IPs: Add `127.0.0.1` and/or `host.docker.internal` (if running in Docker).

### Running the Project (Docker)
1.  **Start TWS:** Ensure TWS is running and logged in.
2.  **Build & Start:**
    ```bash
    docker-compose up --build
    ```
3.  **Access:**
    - Frontend: `http://localhost:8080`
    - Backend: `http://localhost:3000`

### Running Locally (Dev)
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
