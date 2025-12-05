# Assup Implementation Roadmap

This roadmap breaks down the implementation into small, manageable steps. Each step should be completable in a focused work session.

---

## Phase 1: Database Foundation ✅

### 1.1 PostgreSQL Setup
- [x] Add PostgreSQL service to `docker-compose.yml`
- [x] Create `.env.example` with database connection variables
- [x] Update `.gitignore` to exclude `.env`
- [x] Test PostgreSQL container starts correctly

### 1.2 Prisma Setup
- [x] Install Prisma dependencies in backend (`prisma`, `@prisma/client`)
- [x] Initialize Prisma with `npx prisma init`
- [x] Configure `DATABASE_URL` in `.env`
- [x] Update `docker-compose.yml` to pass database URL to backend

### 1.3 Asset Classes Schema
- [x] Define `AssetClass` model in `schema.prisma`
- [x] Create initial migration for asset_classes table
- [x] Generate Prisma client
- [x] Create `src/db/index.ts` to export Prisma client instance

### 1.4 Allocation Profiles Schema
- [x] Define `AllocationProfile` model in `schema.prisma`
- [x] Define `AllocationTarget` model with relation to AssetClass
- [x] Create migration for allocation tables
- [x] Regenerate Prisma client

### 1.5 Security Assignments Schema
- [x] Define `SecurityAssignment` model in `schema.prisma`
- [x] Add relation to AssetClass
- [x] Create migration
- [x] Regenerate Prisma client

### 1.6 Watchlist Schema
- [x] Define `Watchlist` model in `schema.prisma`
- [x] Define `WatchlistItem` model with relation to Watchlist
- [x] Create migration
- [x] Regenerate Prisma client

### 1.7 Settings & Scanner Presets Schema
- [x] Define `Settings` model (key-value with JSONB)
- [x] Define `ScannerPreset` model with JSONB criteria
- [x] Create migration
- [x] Regenerate Prisma client

### 1.8 Database Seeding
- [x] Create `prisma/seed.ts` with default asset classes
- [x] Add default allocation profile with target percentages
- [x] Configure seed script in `package.json`
- [x] Test seeding works correctly

---

## Phase 2: Asset Class Management ✅

### 2.1 Asset Class Service
- [x] Create `src/services/assetClass.ts`
- [x] Implement `getAllAssetClasses()` function
- [x] Implement `getAssetClassById(id)` function
- [x] Implement `createAssetClass(data)` function
- [x] Implement `updateAssetClass(id, data)` function
- [x] Implement `deleteAssetClass(id)` function (with cascade check)

### 2.2 Asset Class API Routes
- [x] Create `src/routes/assetClasses.ts`
- [x] Implement `GET /api/asset-classes` endpoint
- [x] Implement `POST /api/asset-classes` endpoint
- [x] Implement `GET /api/asset-classes/:id` endpoint
- [x] Implement `PUT /api/asset-classes/:id` endpoint
- [x] Implement `DELETE /api/asset-classes/:id` endpoint
- [x] Add input validation (name required, color format)
- [x] Register routes in main `index.ts`

### 2.3 Asset Class Types
- [x] Create `src/types/assetClass.ts` with TypeScript interfaces
- [x] Define `CreateAssetClassInput` type
- [x] Define `UpdateAssetClassInput` type
- [x] Define `AssetClassResponse` type

### 2.4 Frontend: Asset Class List Page
- [x] Create `src/pages/Settings.tsx` page component
- [x] Add Settings route to React Router
- [x] Create `src/components/settings/AssetClassList.tsx`
- [x] Fetch and display asset classes in a table
- [x] Add color indicator column

### 2.5 Frontend: Asset Class Form
- [x] Create `src/components/settings/AssetClassForm.tsx`
- [x] Add name input field
- [x] Add description textarea (optional)
- [x] Add color picker component
- [x] Handle form submission (create/update)

### 2.6 Frontend: Asset Class CRUD UI
- [x] Add "New Asset Class" button to list
- [x] Implement edit action (opens form with existing data)
- [x] Implement delete action with confirmation dialog
- [x] Show loading states during API calls
- [x] Display error messages on failure

---

## Phase 3: Allocation Profile Management ✅

### 3.1 Allocation Service
- [x] Create `src/services/allocation.ts`
- [x] Implement `getAllocationProfiles()` function
- [x] Implement `getActiveAllocation()` function
- [x] Implement `createAllocationProfile(data)` function
- [x] Implement `updateAllocationProfile(id, data)` function
- [x] Implement `deleteAllocationProfile(id)` function
- [x] Implement `activateAllocationProfile(id)` function (deactivate others)

### 3.2 Allocation API Routes
- [x] Create `src/routes/allocations.ts`
- [x] Implement `GET /api/allocations` endpoint
- [x] Implement `POST /api/allocations` endpoint
- [x] Implement `GET /api/allocations/:id` endpoint
- [x] Implement `PUT /api/allocations/:id` endpoint
- [x] Implement `DELETE /api/allocations/:id` endpoint
- [x] Implement `PUT /api/allocations/:id/activate` endpoint
- [x] Add validation (percentages sum to 100)
- [x] Register routes in main `index.ts`

### 3.3 Allocation Types
- [x] Create `src/types/allocation.ts` with TypeScript interfaces
- [x] Define `AllocationTarget` type
- [x] Define `CreateAllocationInput` type
- [x] Define `AllocationProfileResponse` type

### 3.4 Frontend: Allocation Profile List
- [x] Create `src/components/settings/AllocationProfileList.tsx`
- [x] Display profiles with active indicator
- [x] Show target percentages summary
- [x] Add quick-activate button per profile

### 3.5 Frontend: Allocation Profile Editor
- [x] Create `src/components/settings/AllocationEditor.tsx`
- [x] Display all asset classes with percentage inputs
- [x] Show real-time sum validation (must equal 100%)
- [x] Visual indicator when sum is invalid
- [x] Save button enabled only when valid

### 3.6 Frontend: Allocation Profile CRUD
- [x] Add "New Profile" button
- [x] Implement profile switching (activate)
- [x] Implement profile deletion with confirmation
- [x] Handle edge case: cannot delete active profile

---

## Phase 4: Security Assignments

### 4.1 Assignment Service
- [ ] Create `src/services/assignment.ts`
- [ ] Implement `getAllAssignments()` function
- [ ] Implement `getAssignmentBySymbol(symbol)` function
- [ ] Implement `getAssignmentsByAssetClass(assetClassId)` function
- [ ] Implement `createOrUpdateAssignment(data)` function (upsert)
- [ ] Implement `deleteAssignment(symbol)` function

### 4.2 Assignment API Routes
- [ ] Create `src/routes/assignments.ts`
- [ ] Implement `GET /api/assignments` endpoint
- [ ] Implement `GET /api/assignments/:symbol` endpoint
- [ ] Implement `POST /api/assignments` endpoint (upsert)
- [ ] Implement `DELETE /api/assignments/:symbol` endpoint
- [ ] Register routes in main `index.ts`

### 4.3 Assignment Types
- [ ] Create `src/types/assignment.ts`
- [ ] Define `SecurityAssignment` interface
- [ ] Define `CreateAssignmentInput` type

### 4.4 Frontend: Assignment Dropdown Component
- [ ] Create `src/components/common/AssetClassSelect.tsx`
- [ ] Fetch asset classes for dropdown options
- [ ] Display color indicator next to each option
- [ ] Include "Unassigned" option
- [ ] Handle selection change callback

---

## Phase 5: IBKR Positions Integration

### 5.1 IBKR Service: Positions
- [ ] Add `getPositions()` method to `ibkrService`
- [ ] Parse position data from TWS API
- [ ] Map contract details (symbol, conId, secType)
- [ ] Calculate market value and P&L
- [ ] Handle options positions (extract underlying, strike, expiry)

### 5.2 Position Types
- [ ] Create `src/types/position.ts`
- [ ] Define `Position` interface
- [ ] Define `OptionPosition` extended interface
- [ ] Define `PositionSummary` interface (aggregated)

### 5.3 Position API Routes
- [ ] Create `src/routes/positions.ts`
- [ ] Implement `GET /api/positions` endpoint
- [ ] Enrich positions with asset class assignments
- [ ] Implement `GET /api/positions/summary` endpoint
- [ ] Register routes in main `index.ts`

### 5.4 Frontend: Positions Page
- [ ] Create `src/pages/Positions.tsx`
- [ ] Add Positions route to React Router
- [ ] Add navigation link in header

### 5.5 Frontend: Positions Table
- [ ] Create `src/components/positions/PositionsTable.tsx`
- [ ] Display columns: Symbol, Qty, Avg Cost, Market Value, P&L
- [ ] Add Asset Class column with inline `AssetClassSelect`
- [ ] Handle assignment changes (POST to API)
- [ ] Highlight unassigned positions

### 5.6 Frontend: Positions Filtering
- [ ] Add filter by asset class dropdown
- [ ] Add toggle to show/hide options positions
- [ ] Add toggle to group by asset class
- [ ] Persist filter preferences in local storage

---

## Phase 6: Basic Dashboard

### 6.1 Dashboard Service
- [ ] Create `src/services/dashboard.ts`
- [ ] Implement `calculateAllocation()` function
- [ ] Sum position values by asset class
- [ ] Compare against active allocation targets
- [ ] Calculate difference (over/under) for each class

### 6.2 Dashboard API Routes
- [ ] Create `src/routes/dashboard.ts`
- [ ] Implement `GET /api/dashboard/allocation` endpoint
- [ ] Implement `GET /api/dashboard/summary` endpoint (total value, daily P&L)
- [ ] Register routes in main `index.ts`

### 6.3 Dashboard Types
- [ ] Create `src/types/dashboard.ts`
- [ ] Define `AllocationStatus` interface
- [ ] Define `PortfolioSummary` interface

### 6.4 Frontend: Dashboard Page Structure
- [ ] Update `src/pages/Dashboard.tsx` (or create if App.tsx is current)
- [ ] Add dashboard route as home page
- [ ] Create layout with summary header and main content area

### 6.5 Frontend: Portfolio Summary Header
- [ ] Create `src/components/dashboard/PortfolioSummary.tsx`
- [ ] Display total portfolio value
- [ ] Display daily change (amount and percentage)
- [ ] Add loading skeleton while fetching

### 6.6 Frontend: Allocation Table
- [ ] Create `src/components/dashboard/AllocationTable.tsx`
- [ ] Display columns: Asset Class, Target %, Current %, Value, Difference
- [ ] Color-code rows by status (under/over/on-target)
- [ ] Sort by difference (most underinvested first)

### 6.7 Frontend: Allocation Chart
- [ ] Install chart library (recharts or chart.js)
- [ ] Create `src/components/dashboard/AllocationPieChart.tsx`
- [ ] Display current allocation as pie chart
- [ ] Use asset class colors
- [ ] Add legend with percentages

### 6.8 Frontend: Underinvested Classes Panel
- [ ] Create `src/components/dashboard/UnderinvestedPanel.tsx`
- [ ] List asset classes below target threshold
- [ ] Show deficit amount in dollars
- [ ] Add "Find Opportunities" button (placeholder for scanner)

---

## Phase 7: Watchlist Management

### 7.1 Watchlist Service
- [ ] Create `src/services/watchlist.ts`
- [ ] Implement `getAllWatchlists()` function
- [ ] Implement `getWatchlistById(id)` function
- [ ] Implement `createWatchlist(name)` function
- [ ] Implement `updateWatchlist(id, name)` function
- [ ] Implement `deleteWatchlist(id)` function
- [ ] Implement `addWatchlistItem(watchlistId, symbol)` function
- [ ] Implement `removeWatchlistItem(watchlistId, symbol)` function

### 7.2 Watchlist API Routes
- [ ] Create `src/routes/watchlists.ts`
- [ ] Implement `GET /api/watchlists` endpoint
- [ ] Implement `POST /api/watchlists` endpoint
- [ ] Implement `GET /api/watchlists/:id` endpoint
- [ ] Implement `PUT /api/watchlists/:id` endpoint
- [ ] Implement `DELETE /api/watchlists/:id` endpoint
- [ ] Implement `POST /api/watchlists/:id/items` endpoint
- [ ] Implement `DELETE /api/watchlists/:id/items/:symbol` endpoint
- [ ] Register routes in main `index.ts`

### 7.3 IBKR Service: Market Data
- [ ] Add `getMarketData(symbols)` method to `ibkrService`
- [ ] Request real-time quotes for multiple symbols
- [ ] Return last price, change, volume
- [ ] Handle market data subscription cleanup

### 7.4 Frontend: Watchlist Page
- [ ] Create `src/pages/Watchlist.tsx`
- [ ] Add Watchlist route to React Router
- [ ] Add navigation link in header

### 7.5 Frontend: Watchlist Selector
- [ ] Create `src/components/watchlist/WatchlistSelector.tsx`
- [ ] Dropdown to switch between watchlists
- [ ] Button to create new watchlist
- [ ] Button to delete current watchlist

### 7.6 Frontend: Watchlist Table
- [ ] Create `src/components/watchlist/WatchlistTable.tsx`
- [ ] Display columns: Symbol, Last Price, Change, Volume, Asset Class
- [ ] Add Asset Class column with inline `AssetClassSelect`
- [ ] Add remove button per row

### 7.7 Frontend: Add Symbol Form
- [ ] Create `src/components/watchlist/AddSymbolForm.tsx`
- [ ] Symbol input field with validation
- [ ] Auto-complete suggestions (optional, from IBKR)
- [ ] Add button to add symbol to current watchlist

---

## Phase 8: Orders View

### 8.1 IBKR Service: Orders
- [ ] Add `getOpenOrders()` method to `ibkrService`
- [ ] Parse order data from TWS API
- [ ] Map order details (symbol, action, quantity, type, price, status)
- [ ] Handle options orders (underlying, strike, expiry)

### 8.2 Order Types
- [ ] Create `src/types/order.ts`
- [ ] Define `Order` interface
- [ ] Define `OrderImpact` interface

### 8.3 Order Impact Service
- [ ] Create `src/services/orderImpact.ts`
- [ ] Implement `calculateOrderImpact(orders)` function
- [ ] For each order, calculate projected allocation change
- [ ] Determine if impact improves or worsens allocation
- [ ] Calculate aggregate impact of all orders

### 8.4 Order API Routes
- [ ] Create `src/routes/orders.ts`
- [ ] Implement `GET /api/orders` endpoint
- [ ] Implement `GET /api/orders/impact` endpoint
- [ ] Register routes in main `index.ts`

### 8.5 Frontend: Orders Page
- [ ] Create `src/pages/Orders.tsx`
- [ ] Add Orders route to React Router
- [ ] Add navigation link in header

### 8.6 Frontend: Orders Table
- [ ] Create `src/components/orders/OrdersTable.tsx`
- [ ] Display columns: Symbol, Action, Qty, Type, Price, Status, Asset Class
- [ ] Add Impact column with colored indicator (green/red/neutral)
- [ ] Show tooltip with impact details

### 8.7 Frontend: Aggregate Impact Panel
- [ ] Create `src/components/orders/AggregateImpact.tsx`
- [ ] Show table of projected allocation after all orders execute
- [ ] Highlight changes from current allocation
- [ ] Compare against target allocation

---

## Phase 9: Options in Dashboard

### 9.1 Dashboard Settings Service
- [ ] Add settings CRUD to `src/services/settings.ts`
- [ ] Implement `getSetting(key)` function
- [ ] Implement `setSetting(key, value)` function
- [ ] Define dashboard settings keys

### 9.2 Dashboard Settings API
- [ ] Add `GET /api/dashboard/settings` endpoint
- [ ] Add `PUT /api/dashboard/settings` endpoint

### 9.3 Options Allocation Calculation
- [ ] Update `calculateAllocation()` to accept options toggle
- [ ] Implement notional value calculation for PUTs
- [ ] Implement notional value calculation for CALLs
- [ ] Add options exposure to asset class totals

### 9.4 Delta-Weighted Calculation
- [ ] Add `getOptionGreeks(positions)` to IBKR service
- [ ] Fetch delta for each option position
- [ ] Implement delta-weighted exposure calculation
- [ ] Update allocation calculation to use delta when enabled

### 9.5 Frontend: Options Toggle
- [ ] Add toggle switch to Dashboard header
- [ ] Add options weight mode selector (notional/delta)
- [ ] Persist settings via API
- [ ] Refresh allocation data when toggle changes

### 9.6 Frontend: Options Breakdown
- [ ] Create `src/components/dashboard/OptionsBreakdown.tsx`
- [ ] Show options exposure by asset class
- [ ] Display PUT exposure and CALL reduction separately
- [ ] Expandable section in dashboard

---

## Phase 10: Options Scanner - Backend

### 10.1 IBKR Service: Options Chain
- [ ] Add `getOptionsChain(symbol)` method to `ibkrService`
- [ ] Request options contracts for given underlying
- [ ] Filter by expiration range
- [ ] Return strikes, expirations, and contract IDs

### 10.2 IBKR Service: Options Market Data
- [ ] Add `getOptionsMarketData(contracts)` method
- [ ] Request bid/ask/last for option contracts
- [ ] Request Greeks (delta, gamma, theta, vega, IV)
- [ ] Batch requests for efficiency

### 10.3 Scanner Service
- [ ] Create `src/services/scanner.ts`
- [ ] Implement `runScan(criteria)` function
- [ ] Get symbols for target asset classes
- [ ] Fetch options chains for each symbol
- [ ] Filter options by criteria (DTE, delta, etc.)

### 10.4 Scanner Metrics Calculation
- [ ] Calculate premium percentage (premium / strike)
- [ ] Calculate annualized return
- [ ] Calculate max profit/loss
- [ ] Calculate breakeven price

### 10.5 Scanner Scoring
- [ ] Implement `calculateOpportunityScore()` function
- [ ] Score by allocation deficit (40%)
- [ ] Score by risk-adjusted return (30%)
- [ ] Score by liquidity (15%)
- [ ] Score by DTE sweet spot (15%)

### 10.6 Scanner API Routes
- [ ] Create `src/routes/scanner.ts`
- [ ] Implement `POST /api/scanner/run` endpoint
- [ ] Implement `GET /api/scanner/criteria` endpoint
- [ ] Implement `PUT /api/scanner/criteria` endpoint
- [ ] Implement `GET /api/scanner/symbols/:assetClassId` endpoint
- [ ] Register routes in main `index.ts`

### 10.7 Scanner Presets Service
- [ ] Add preset CRUD to scanner service
- [ ] Implement `getScannerPresets()` function
- [ ] Implement `saveScannerPreset(name, criteria)` function
- [ ] Implement `deleteScannerPreset(id)` function
- [ ] Implement `getDefaultPreset()` function

---

## Phase 11: Options Scanner - Frontend

### 11.1 Scanner Page Structure
- [ ] Create `src/pages/Scanner.tsx`
- [ ] Add Scanner route to React Router
- [ ] Add navigation link in header
- [ ] Create two-panel layout (criteria + results)

### 11.2 Scanner Criteria Form
- [ ] Create `src/components/scanner/ScannerCriteriaForm.tsx`
- [ ] Add asset class multi-select (or "underinvested only" toggle)
- [ ] Add DTE range inputs (min/max days)
- [ ] Add delta range inputs (min/max)
- [ ] Add minimum annualized return input
- [ ] Add minimum premium % input
- [ ] Add strategy type selector (PUT/CALL/both)

### 11.3 Scanner Presets UI
- [ ] Create `src/components/scanner/PresetSelector.tsx`
- [ ] Dropdown to select saved preset
- [ ] "Save as Preset" button
- [ ] "Delete Preset" button

### 11.4 Scanner Results Table
- [ ] Create `src/components/scanner/ScannerResults.tsx`
- [ ] Display columns: Underlying, Strike, Expiry, Bid×Ask, Delta, Premium %, Return, Score
- [ ] Color-code by score (gradient)
- [ ] Sort by score (default), or by other columns

### 11.5 Scanner Result Details
- [ ] Create `src/components/scanner/OpportunityDetails.tsx`
- [ ] Show detailed metrics on row click/expand
- [ ] Display breakeven, max profit, max loss
- [ ] Show asset class context (current allocation deficit)

### 11.6 Scanner Filters
- [ ] Add quick filters above results table
- [ ] Filter by asset class
- [ ] Filter by expiration range slider
- [ ] Filter by delta range slider
- [ ] Filter by minimum return

### 11.7 Scanner Loading State
- [ ] Show progress indicator during scan
- [ ] Display "Scanning X symbols..." message
- [ ] Allow cancellation of in-progress scan
- [ ] Handle and display errors gracefully

---

## Phase 12: Real-time Updates

### 12.1 SSE Infrastructure
- [ ] Create `src/services/sse.ts` for SSE management
- [ ] Implement client connection tracking
- [ ] Implement broadcast function to all clients
- [ ] Handle client disconnection cleanup

### 12.2 Position Updates SSE
- [ ] Subscribe to IBKR position updates
- [ ] Broadcast position changes via SSE
- [ ] Include asset class assignment in updates

### 12.3 Order Updates SSE
- [ ] Subscribe to IBKR order status updates
- [ ] Broadcast order changes via SSE
- [ ] Recalculate impact on order changes

### 12.4 Frontend: SSE Client
- [ ] Create `src/hooks/useSSE.ts` custom hook
- [ ] Handle connection, reconnection, and errors
- [ ] Parse SSE messages by type

### 12.5 Frontend: Real-time Position Updates
- [ ] Connect to positions SSE stream
- [ ] Update positions table in real-time
- [ ] Update dashboard allocation in real-time

### 12.6 Frontend: Real-time Order Updates
- [ ] Connect to orders SSE stream
- [ ] Update orders table in real-time
- [ ] Update impact calculations in real-time

---

## Phase 13: Navigation & Polish

### 13.1 Navigation Component
- [ ] Create `src/components/layout/Navigation.tsx`
- [ ] Add links: Dashboard, Positions, Watchlist, Orders, Scanner, Settings
- [ ] Highlight active route
- [ ] Mobile-responsive menu

### 13.2 Layout Component
- [ ] Create `src/components/layout/Layout.tsx`
- [ ] Include header with logo and navigation
- [ ] Include connection status indicator
- [ ] Add main content area with consistent padding

### 13.3 Loading States
- [ ] Create `src/components/common/LoadingSkeleton.tsx`
- [ ] Apply to all data-fetching components
- [ ] Ensure smooth transitions

### 13.4 Error Handling
- [ ] Create `src/components/common/ErrorBoundary.tsx`
- [ ] Create `src/components/common/ErrorMessage.tsx`
- [ ] Add retry buttons where appropriate
- [ ] Log errors for debugging

### 13.5 Empty States
- [ ] Create empty state components for each list
- [ ] Provide helpful guidance (e.g., "Add your first asset class")
- [ ] Include call-to-action buttons

### 13.6 Responsive Design
- [ ] Test and fix mobile layouts for all pages
- [ ] Ensure tables scroll horizontally on small screens
- [ ] Adjust chart sizes for different viewports

---

## Phase 14: Testing & Documentation

### 14.1 Backend Unit Tests
- [ ] Set up Jest for backend testing
- [ ] Write tests for asset class service
- [ ] Write tests for allocation service
- [ ] Write tests for assignment service
- [ ] Write tests for dashboard calculations

### 14.2 API Integration Tests
- [ ] Set up test database
- [ ] Write tests for asset class endpoints
- [ ] Write tests for allocation endpoints
- [ ] Write tests for assignment endpoints

### 14.3 Frontend Component Tests
- [ ] Set up Vitest for frontend testing
- [ ] Write tests for AssetClassForm
- [ ] Write tests for AllocationEditor
- [ ] Write tests for PositionsTable

### 14.4 E2E Tests
- [ ] Set up Playwright or Cypress
- [ ] Write test for asset class CRUD flow
- [ ] Write test for allocation profile flow
- [ ] Write test for position assignment flow

### 14.5 API Documentation
- [ ] Document all API endpoints
- [ ] Include request/response examples
- [ ] Document error codes and messages

### 14.6 User Documentation
- [ ] Write getting started guide
- [ ] Document TWS configuration requirements
- [ ] Create FAQ section

---

## Milestone Summary

| Phase | Description | Key Deliverables |
|-------|-------------|------------------|
| 1 | Database Foundation | PostgreSQL + Prisma schema |
| 2 | Asset Class Management | CRUD API + Settings UI |
| 3 | Allocation Profiles | Profile management + validation |
| 4 | Security Assignments | Assignment API + dropdown component |
| 5 | IBKR Positions | Positions API + table with assignments |
| 6 | Basic Dashboard | Allocation view + charts |
| 7 | Watchlist | Watchlist CRUD + market data |
| 8 | Orders View | Orders + impact analysis |
| 9 | Options in Dashboard | Options toggle + delta weighting |
| 10 | Scanner Backend | Options chain + scoring |
| 11 | Scanner Frontend | Criteria form + results table |
| 12 | Real-time Updates | SSE for positions/orders |
| 13 | Navigation & Polish | Layout + error handling + responsive |
| 14 | Testing & Docs | Unit tests + E2E + documentation |
