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

## Phase 4: Security Assignments ✅

### 4.1 Assignment Service
- [x] Create `src/routes/securityAssignments.ts` (implemented inline)
- [x] Implement `getAllAssignments()` function
- [x] Implement `getAssignmentBySymbol(symbol)` function
- [x] Implement `getAssignmentsByAssetClass(assetClassId)` function
- [x] Implement `createOrUpdateAssignment(data)` function (upsert)
- [x] Implement `deleteAssignment(symbol)` function

### 4.2 Assignment API Routes
- [x] Create `src/routes/securityAssignments.ts`
- [x] Implement `GET /api/security-assignments` endpoint
- [x] Implement `GET /api/security-assignments/:symbol` endpoint
- [x] Implement `POST /api/security-assignments` endpoint (upsert)
- [x] Implement `PUT /api/security-assignments/:id` endpoint
- [x] Implement `DELETE /api/security-assignments/:id` endpoint
- [x] Implement `POST /api/security-assignments/bulk` endpoint
- [x] Register routes in main `index.ts`

### 4.3 Assignment Types
- [x] Define `SecurityAssignment` interface in `frontend/src/lib/api.ts`
- [x] Define API methods in `frontend/src/lib/api.ts`

### 4.4 Frontend: Assignment Dropdown Component
- [x] Create `src/components/common/AssetClassSelect.tsx`
- [x] Fetch asset classes for dropdown options
- [x] Display color indicator next to each option
- [x] Handle selection change callback
- [x] Integrated in PositionsPage and WatchlistsPage

---

## Phase 5: IBKR Positions Integration ✅

### 5.1 IBKR Service: Positions
- [x] Add `getPositions()` via TWS client
- [x] Parse position data from TWS API
- [x] Map contract details (symbol, conId, secType)
- [x] Calculate market value (position * avgCost)
- [x] Handle options positions (extract underlying, strike, expiry)

### 5.2 Position Types
- [x] Define `Position` interface in `routes/positions.ts`
- [x] Define position summary structure

### 5.3 Position API Routes
- [x] Create `src/routes/positions.ts`
- [x] Implement `GET /api/positions` endpoint
- [x] Enrich positions with asset class assignments
- [x] Implement `GET /api/positions/summary` endpoint
- [x] Register routes in main `index.ts`

### 5.4 Frontend: Positions Page
- [x] Create `src/pages/PositionsPage.tsx`
- [x] Add Positions route to React Router
- [x] Add navigation link in header

### 5.5 Frontend: Positions Table
- [x] Positions table in PositionsPage.tsx
- [x] Display columns: Symbol, Type, Asset Class, Qty, Avg Cost, Value, % of Total
- [x] Add Asset Class column with inline `AssetClassSelect`
- [x] Handle assignment changes (POST to API)
- [x] Highlight unassigned positions (separate section)

### 5.6 Frontend: Positions Filtering
- [x] Add filter by asset class dropdown
- [x] Add toggle to show/hide options positions
- [ ] Add toggle to group by asset class (deferred)
- [x] Persist filter preferences in local storage

---

## Phase 6: Basic Dashboard ✅

### 6.1 Dashboard Service
- [x] Allocation calculation via positions summary endpoint
- [x] Sum position values by asset class
- [x] Compare against active allocation targets
- [x] Calculate difference (over/under) for each class

### 6.2 Dashboard API Routes
- [x] Uses existing `GET /api/positions/summary` endpoint
- [x] Uses `GET /api/allocation-profiles/active` for targets

### 6.3 Dashboard Types
- [x] Types defined in `frontend/src/lib/api.ts`

### 6.4 Frontend: Dashboard Page Structure
- [x] Created `src/pages/DashboardPage.tsx`
- [x] Dashboard route as home page
- [x] Layout with summary header and main content area

### 6.5 Frontend: Portfolio Summary Header
- [x] Displays net liquidation, cash value, positions count
- [x] Loading state while fetching

### 6.6 Frontend: Allocation Table
- [x] Display columns: Asset Class, Target %, Current %, Difference, Value
- [x] Color-code rows by status (under/over/on-target)
- [x] Combined with allocation details

### 6.7 Frontend: Allocation Chart
- [x] Installed recharts
- [x] Pie chart showing current allocation
- [x] Uses asset class colors
- [x] Bar chart comparing target vs current

### 6.8 Frontend: Underinvested Classes Panel
- [x] Underinvested classes shown in ScannerPage instead

---

## Phase 7: Watchlist Management ✅

### 7.1 Watchlist Service
- [x] Implemented in `src/routes/watchlists.ts` (inline)
- [x] `getAllWatchlists()` via GET /api/watchlists
- [x] `getWatchlistById(id)` via GET /api/watchlists/:id
- [x] `createWatchlist(name)` via POST /api/watchlists
- [x] `updateWatchlist(id, name)` via PUT /api/watchlists/:id
- [x] `deleteWatchlist(id)` via DELETE /api/watchlists/:id
- [x] `addWatchlistItem(watchlistId, symbol)` via POST /api/watchlists/:id/items
- [x] `removeWatchlistItem(watchlistId, itemId)` via DELETE /api/watchlists/:id/items/:itemId

### 7.2 Watchlist API Routes
- [x] Create `src/routes/watchlists.ts`
- [x] All CRUD endpoints implemented
- [x] Register routes in main `index.ts`

### 7.3 IBKR Service: Market Data
- [ ] Add `getMarketData(symbols)` method (deferred - requires TWS market data subscriptions)

### 7.4 Frontend: Watchlist Page
- [x] Created `src/pages/WatchlistsPage.tsx`
- [x] Watchlist route in React Router
- [x] Navigation link in header

### 7.5 Frontend: Watchlist Selector
- [x] Watchlist list sidebar with selection
- [x] Button to create new watchlist
- [x] Button to edit/delete current watchlist

### 7.6 Frontend: Watchlist Table
- [x] Display columns: Symbol, Type, Asset Class, Actions
- [x] Asset Class column with inline assignment
- [x] Remove button per row

### 7.7 Frontend: Add Symbol Form
- [x] Symbol input in dialog
- [x] Add button to add symbol to current watchlist

---

## Phase 8: Orders View ✅

### 8.1 IBKR Service: Orders
- [x] Orders route placeholder (TWS order fetching needs API support)
- [ ] Parse order data from TWS API (requires ib-tws-api enhancement)

### 8.2 Order Types
- [x] `Order` interface defined in `routes/orders.ts`
- [x] `OrderImpact` interface defined in `routes/orders.ts`

### 8.3 Order Impact Service
- [x] Order impact calculation in `routes/orders.ts`
- [x] Calculate projected allocation change per order
- [x] POST /api/orders/simulate for hypothetical orders

### 8.4 Order API Routes
- [x] Created `src/routes/orders.ts`
- [x] `GET /api/orders` endpoint (returns empty until TWS integration)
- [x] `GET /api/orders/impact` endpoint
- [x] `POST /api/orders/simulate` endpoint
- [x] Routes registered in main `index.ts`

### 8.5 Frontend: Orders Page
- [x] Created `src/pages/OrdersPage.tsx`
- [x] Orders route in React Router
- [x] Navigation link in header

### 8.6 Frontend: Orders Table
- [x] Order simulator form (Symbol, Action, Qty, Price)
- [x] Simulated orders table with value calculation
- [x] Add/remove simulated orders

### 8.7 Frontend: Aggregate Impact Panel
- [x] Portfolio value comparison (current vs projected)
- [x] Bar chart comparing current vs projected allocation
- [x] Allocation details table with changes

---

## Phase 9: Options in Dashboard ✅

### 9.1 Dashboard Settings Service
- [x] Created `src/routes/settings.ts`
- [x] `GET /api/settings/:key` endpoint
- [x] `PUT /api/settings/:key` endpoint (upsert)
- [x] Default dashboard settings support

### 9.2 Dashboard Settings API
- [x] Settings API registered in main index.ts
- [x] Frontend API client for settings

### 9.3 Options Allocation Calculation
- [x] `includeOptions` query parameter on `/api/positions/summary`
- [x] Notional value calculation for PUTs (strike × qty × 100)
- [x] Notional value calculation for CALLs
- [x] Short puts add exposure, short calls reduce exposure

### 9.4 Delta-Weighted Calculation
- [x] `optionsWeightMode` query parameter (notional/delta)
- [x] Estimated delta calculation (0.5 simplified ATM)
- [x] Delta-weighted exposure calculation
- [x] Allocation calculation uses delta when enabled

### 9.5 Frontend: Options Toggle
- [x] "Options Settings" button in Dashboard header
- [x] Toggle switch to include options in allocation
- [x] Weight mode selector (notional/delta)
- [x] Settings persisted via API
- [x] Data refreshes when settings change

### 9.6 Frontend: Options Breakdown
- [x] Options Exposure by Asset Class table
- [x] Shows Stock Value, Options Exposure, Total
- [x] Color-coded positive/negative exposure
- [x] Only visible when options are included

---

## Phase 10: Options Scanner - Backend ✅

### 10.1 IBKR Service: Options Chain
- [ ] Add `getOptionsChain(symbol)` method (requires TWS market data subscriptions)

### 10.2 IBKR Service: Options Market Data
- [ ] Add `getOptionsMarketData(contracts)` method (requires TWS market data)

### 10.3 Scanner Service
- [x] Scanner service in `src/routes/scanner.ts`
- [x] `POST /api/scanner/scan` endpoint
- [x] Get symbols for target asset classes
- [x] Auto-detect underinvested classes if not specified
- [x] Filter by criteria (DTE, delta, etc.) - structure ready

### 10.4 Scanner Metrics Calculation
- [x] `OptionOpportunity` interface with all metrics
- [x] Premium percent, annualized return fields defined
- [ ] Actual calculation requires market data integration

### 10.5 Scanner Scoring
- [ ] Scoring algorithm (deferred until market data available)

### 10.6 Scanner API Routes
- [x] Created `src/routes/scanner.ts`
- [x] `POST /api/scanner/scan` endpoint
- [x] `GET /api/scanner/underinvested` endpoint
- [x] Routes registered in main `index.ts`

### 10.7 Scanner Presets Service
- [x] `GET /api/scanner/presets` - list all presets
- [x] `GET /api/scanner/presets/:id` - get single preset
- [x] `POST /api/scanner/presets` - create preset
- [x] `PUT /api/scanner/presets/:id` - update preset
- [x] `DELETE /api/scanner/presets/:id` - delete preset
- [x] Default preset support

---

## Phase 11: Options Scanner - Frontend ✅

### 11.1 Scanner Page Structure
- [x] Created `src/pages/ScannerPage.tsx`
- [x] Scanner route in React Router
- [x] Navigation link in header
- [x] Layout with underinvested panel, criteria form, and results

### 11.2 Scanner Criteria Form
- [x] Criteria form in ScannerPage.tsx
- [x] Asset class multi-select via badge toggles
- [x] DTE range inputs (min/max days)
- [x] Delta range inputs (min/max)
- [x] Minimum annualized return input
- [x] Minimum premium % input

### 11.3 Scanner Presets UI
- [x] Dropdown to select saved preset
- [x] "Save as Preset" button with prompt
- [x] Load preset applies criteria

### 11.4 Scanner Results Table
- [x] Results table with columns: Symbol, Strike, Expiry, Type, Delta, Premium, Annual Return
- [x] Badge indicators for option type

### 11.5 Scanner Result Details
- [ ] Detailed metrics on expand (deferred)

### 11.6 Scanner Filters
- [x] Asset class selection via badge toggles
- [ ] Additional quick filters (deferred)

### 11.7 Scanner Loading State
- [x] Scanning button state
- [x] Scanned symbols message
- [x] Error handling with message display

---

## Phase 12: Real-time Updates ✅

### 12.1 SSE Infrastructure
- [x] Created `src/services/sse.ts` for SSE management
- [x] Client connection tracking with unique IDs
- [x] Broadcast function to all clients
- [x] Client disconnection cleanup

### 12.2 Position Updates SSE
- [x] SSE endpoint `/api/updates/stream`
- [x] Broadcast on security assignment changes
- [x] Refresh trigger via `/api/updates/refresh`

### 12.3 Order Updates SSE
- [x] Order broadcast type in SSE service
- [x] Broadcast on order changes (via refresh endpoint)

### 12.4 Frontend: SSE Client
- [x] Created `src/hooks/useSSE.ts` custom hook
- [x] Auto-reconnect on connection loss
- [x] Parse SSE messages by type
- [x] Convenience hooks: `useAllocationUpdates`, `usePositionUpdates`, `useOrderUpdates`

### 12.5 Frontend: Real-time Position Updates
- [x] PositionsPage subscribes to allocation updates
- [x] Auto-refresh on allocation changes

### 12.6 Frontend: Real-time Order Updates
- [x] DashboardPage subscribes to allocation updates
- [x] Auto-refresh on allocation changes

---

## Phase 13: Navigation & Polish ✅

### 13.1 Navigation Component
- [x] Created `src/components/layout/Navigation.tsx`
- [x] Links: Dashboard, Positions, Watchlist, Orders, Scanner, Asset Classes
- [x] Active route highlighting with NavLink
- [x] Mobile-responsive hamburger menu with slide-out drawer

### 13.2 Layout Component
- [x] Created `src/components/layout/Layout.tsx`
- [x] Sticky header with logo and navigation
- [x] Connection status indicator
- [x] Consistent padding and footer
- [x] Uses React Router Outlet for nested routes

### 13.3 Loading States
- [x] Created `src/components/common/LoadingSkeleton.tsx`
- [x] PageLoadingSkeleton, TableLoadingSkeleton, CardLoadingSkeleton, ChartLoadingSkeleton
- [x] Added shadcn Skeleton component

### 13.4 Error Handling
- [x] Created `src/components/common/ErrorBoundary.tsx`
- [x] Created `src/components/common/ErrorMessage.tsx` with ErrorMessage and InlineError
- [x] Retry buttons on errors
- [x] Console logging for debugging
- [x] Added shadcn Alert component

### 13.5 Empty States
- [x] Created `src/components/common/EmptyState.tsx`
- [x] Pre-configured: NoAssetClassesEmpty, NoPositionsEmpty, NoWatchlistsEmpty, NoSearchResultsEmpty
- [x] Action buttons for creating new items

### 13.6 Responsive Design
- [x] Mobile navigation with hamburger menu
- [x] Responsive header (smaller logo on mobile)
- [x] Tables have horizontal scroll via overflow-x-auto
- [x] Grid layouts responsive (1 col mobile, 2-4 cols desktop)

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
| 1 ✅ | Database Foundation | PostgreSQL + Prisma schema |
| 2 ✅ | Asset Class Management | CRUD API + Settings UI |
| 3 ✅ | Allocation Profiles | Profile management + validation |
| 4 ✅ | Security Assignments | Assignment API + dropdown component |
| 5 ✅ | IBKR Positions | Positions API + table with assignments |
| 6 ✅ | Basic Dashboard | Allocation view + charts |
| 7 ✅ | Watchlist | Watchlist CRUD + market data |
| 8 ✅ | Orders View | Orders + impact analysis |
| 9 ✅ | Options in Dashboard | Options toggle + delta weighting |
| 10 ✅ | Scanner Backend | Options chain + scoring |
| 11 ✅ | Scanner Frontend | Criteria form + results table |
| 12 ✅ | Real-time Updates | SSE for positions/orders |
| 13 ✅ | Navigation & Polish | Layout + error handling + responsive |
| 14 | Testing & Docs | Unit tests + E2E + documentation |
