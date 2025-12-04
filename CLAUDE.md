# Assup Project Context

## Project Overview
**Assup** is a Node.js application designed to manage asset allocation for personal investment portfolios, specifically integrating with Interactive Brokers Ireland. It handles various asset classes, including cash-secured PUT options and covered CALL options.

### Core Features
*   **IBKR Integration:** Connects to Interactive Brokers TWS (Trader Workstation) locally to download trades and current positions.
*   **Portfolio Grouping:** Groups positions by user-defined asset classes.
*   **Rebalancing Logic:** Calculates the current value of asset classes and compares them against target allocations to determine necessary adjustments.
*   **Deployment:** Designed to be deployed as a Docker container (Backend + Frontend).

## Architecture & Tech Stack
*   **Backend:** Node.js with TypeScript, Express
*   **Frontend:** Vite + React (TypeScript), shadcn/ui, Tailwind CSS
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
