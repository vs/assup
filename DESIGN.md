# Assup System Design

## Overview

Assup is an asset allocation management system that integrates with Interactive Brokers TWS to provide portfolio tracking, rebalancing guidance, and options opportunity discovery. The system enables users to define custom asset classes, assign securities to those classes, monitor allocation status, and identify investment opportunities through options analysis.

---

## Core Concepts

### Asset Class

An **Asset Class** represents a category of investments that share similar characteristics. Users define their own asset classes (e.g., "Stocks: Tech", "Bonds: US", "Metals") to organize their portfolio according to their investment strategy.

```typescript
interface AssetClass {
  id: string;           // Unique identifier (UUID)
  name: string;         // Display name (e.g., "Stocks: Tech")
  description?: string; // Optional description
  color: string;        // Color for UI visualization
  createdAt: Date;
  updatedAt: Date;
}
```

### Asset Allocation

An **Asset Allocation** defines the target portfolio distribution across asset classes. The sum of all allocations must equal 100%.

```typescript
interface AllocationTarget {
  assetClassId: string;
  targetPercentage: number; // 0-100, sum must equal 100
}

interface AssetAllocation {
  id: string;
  name: string;           // e.g., "Aggressive Growth", "Conservative"
  targets: AllocationTarget[];
  isActive: boolean;      // Only one allocation can be active at a time
  createdAt: Date;
  updatedAt: Date;
}
```

### Security Assignment

A **Security Assignment** maps a specific security (identified by its contract/symbol) to an asset class.

```typescript
interface SecurityAssignment {
  id: string;
  symbol: string;         // Stock symbol (e.g., "AAPL", "TLT")
  conId?: number;         // IBKR contract ID (for unambiguous identification)
  secType: string;        // Security type: STK, ETF, OPT, etc.
  assetClassId: string;   // Reference to AssetClass
  source: 'watchlist' | 'position'; // Where assignment was made
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Data Model

### Entity Relationships

```
┌─────────────────┐       ┌─────────────────────┐
│   AssetClass    │◄──────│  SecurityAssignment │
└─────────────────┘       └─────────────────────┘
        ▲                           │
        │                           │
        │                     ┌─────┴─────┐
        │                     ▼           ▼
┌───────┴─────────┐    ┌──────────┐  ┌──────────┐
│ AllocationTarget│    │ Watchlist│  │ Position │
└─────────────────┘    └──────────┘  └──────────┘
        ▲
        │
┌───────┴─────────┐
│ AssetAllocation │
└─────────────────┘
```

### Watchlist

A user-curated list of securities for monitoring.

```typescript
interface WatchlistItem {
  id: string;
  symbol: string;
  conId?: number;
  secType: string;
  assetClassId?: string;  // Optional - can be unassigned
  addedAt: Date;
}

interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Position (from IBKR)

Represents a current holding in the portfolio. Positions are fetched from IBKR and enriched with asset class assignments.

```typescript
interface Position {
  symbol: string;
  conId: number;
  secType: string;          // STK, OPT, etc.
  quantity: number;
  averageCost: number;
  marketValue: number;
  unrealizedPnL: number;
  assetClassId?: string;    // User-assigned

  // For options
  underlying?: string;      // Underlying symbol
  strike?: number;
  expiration?: Date;
  right?: 'C' | 'P';        // Call or Put
  multiplier?: number;      // Usually 100 for stock options
}
```

### Order (from IBKR)

Represents an open or pending order.

```typescript
interface Order {
  orderId: number;
  symbol: string;
  conId: number;
  secType: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  orderType: string;        // LMT, MKT, STP, etc.
  limitPrice?: number;
  status: string;
  filledQuantity: number;

  // For options
  underlying?: string;
  strike?: number;
  expiration?: Date;
  right?: 'C' | 'P';

  // Computed impact
  estimatedValue: number;
  assetClassId?: string;    // Derived from underlying/symbol assignment
}
```

---

## Feature Specifications

### 1. Asset Class Management

**Purpose:** Allow users to create, edit, and delete custom asset classes.

**UI Location:** Settings or dedicated "Asset Classes" page

**Functionality:**
- CRUD operations for asset classes
- Color picker for visual distinction in charts
- Prevent deletion of asset classes that have assigned securities (or cascade unassign)
- Default asset classes seeded on first use (configurable)

**API Endpoints:**
```
GET    /api/asset-classes           - List all asset classes
POST   /api/asset-classes           - Create asset class
PUT    /api/asset-classes/:id       - Update asset class
DELETE /api/asset-classes/:id       - Delete asset class
```

---

### 2. Asset Allocation Configuration

**Purpose:** Define target portfolio allocation percentages.

**UI Location:** Settings or "Allocation" page

**Functionality:**
- Create/edit allocation profiles
- Visual slider or input for percentage assignment
- Real-time validation that percentages sum to 100%
- Ability to save multiple allocation profiles (only one active)
- Quick-switch between allocation profiles

**API Endpoints:**
```
GET    /api/allocations             - List all allocation profiles
POST   /api/allocations             - Create allocation profile
PUT    /api/allocations/:id         - Update allocation profile
DELETE /api/allocations/:id         - Delete allocation profile
PUT    /api/allocations/:id/activate - Set as active allocation
```

---

### 3. Security Assignment

**Purpose:** Assign any security to exactly one asset class.

**UI Location:** Inline in Watchlist view, Positions view, or dedicated assignment page

**Functionality:**
- Dropdown selector to assign asset class
- Search/filter securities by symbol
- Bulk assignment capability
- Visual indicator for unassigned securities
- Assignment persists across sessions (stored in database)
- Option contracts inherit asset class from underlying (configurable per-option)

**API Endpoints:**
```
GET    /api/assignments             - List all assignments
POST   /api/assignments             - Create/update assignment
DELETE /api/assignments/:symbol     - Remove assignment
GET    /api/assignments/:symbol     - Get assignment for symbol
```

---

### 4. Watchlist Management

**Purpose:** Maintain a list of securities for monitoring and potential investment.

**UI Location:** Dedicated "Watchlist" page

**Functionality:**
- Add/remove securities from watchlist
- Display current price, change, volume (fetched from IBKR)
- Asset class column with inline assignment
- Multiple watchlists support
- Sort/filter by asset class, price change, etc.
- Quick action to view options chain

**API Endpoints:**
```
GET    /api/watchlists              - List all watchlists
POST   /api/watchlists              - Create watchlist
PUT    /api/watchlists/:id          - Update watchlist
DELETE /api/watchlists/:id          - Delete watchlist
POST   /api/watchlists/:id/items    - Add item to watchlist
DELETE /api/watchlists/:id/items/:symbol - Remove item
```

---

### 5. Positions View

**Purpose:** Display current portfolio positions with asset class assignments.

**UI Location:** "Positions" or "Portfolio" page

**Functionality:**
- Fetch positions from IBKR in real-time
- Display: symbol, quantity, market value, P&L, asset class
- Inline asset class assignment dropdown
- Filter by asset class
- Group by asset class toggle
- Separate sections or toggle for stock positions vs. options
- For options: show underlying, strike, expiration, delta

**API Endpoints:**
```
GET    /api/positions               - Fetch current positions from IBKR
GET    /api/positions/summary       - Aggregated by asset class
```

---

### 6. Allocation Dashboard

**Purpose:** Visualize current vs. target allocation and identify rebalancing needs.

**UI Location:** Main "Dashboard" page

**Components:**

#### 6.1 Allocation Summary

Display current allocation status:

| Asset Class | Target % | Current % | Current Value | Difference | Status |
|-------------|----------|-----------|---------------|------------|--------|
| Stocks: Tech | 20% | 18% | $45,000 | -$5,000 | Under |
| Bonds: US | 25% | 28% | $70,000 | +$7,500 | Over |

**Status Indicators:**
- **Under:** Current < Target - Threshold (e.g., 2%)
- **On Target:** Within threshold
- **Over:** Current > Target + Threshold

#### 6.2 Visualization

- **Pie Chart:** Current allocation breakdown
- **Bar Chart:** Current vs. Target comparison
- **Heatmap:** Over/Under by intensity

#### 6.3 Options Toggle

**Purpose:** Include/exclude options positions in allocation calculation.

**Behavior when enabled:**
- PUT options: Add notional value (strike × multiplier × quantity) to underlying's asset class
- CALL options: Covered calls reduce exposure by notional value
- Delta-weighted mode (advanced): Weight by delta instead of full notional

```typescript
interface DashboardSettings {
  includeOptions: boolean;
  optionsWeightMode: 'notional' | 'delta-weighted';
}
```

**Calculation Logic:**

```typescript
// For cash-secured PUT (you're obligated to buy)
// Exposure = strike × multiplier × |quantity|
putExposure = strike * 100 * Math.abs(quantity);

// For covered CALL (you've sold upside)
// This reduces your effective stock exposure
callReduction = strike * 100 * Math.abs(quantity);

// Delta-weighted (more sophisticated)
putExposure = strike * 100 * Math.abs(quantity) * Math.abs(delta);
callReduction = strike * 100 * Math.abs(quantity) * Math.abs(delta);
```

**API Endpoints:**
```
GET    /api/dashboard/allocation    - Current allocation status
GET    /api/dashboard/summary       - Portfolio summary statistics
PUT    /api/dashboard/settings      - Update dashboard settings
```

---

### 7. Orders View with Impact Analysis

**Purpose:** Display open orders and show how execution would affect allocation.

**UI Location:** "Orders" page or section in Dashboard

**Functionality:**

#### 7.1 Order List

Display all open orders:
- Symbol, Action (BUY/SELL), Quantity, Order Type, Limit Price, Status
- Asset class (derived from security assignment)
- Estimated execution value

#### 7.2 Impact Simulation

For each order, calculate and display:

```typescript
interface OrderImpact {
  orderId: number;
  assetClassId: string;
  currentAllocation: number;     // Current % for this asset class
  projectedAllocation: number;   // % after order executes
  currentValue: number;          // Current $ in asset class
  projectedValue: number;        // $ after order executes
  targetPercentage: number;      // Target % for comparison
  impact: 'improves' | 'worsens' | 'neutral';
}
```

**Visual Indicators:**
- Green: Order moves allocation closer to target
- Red: Order moves allocation away from target
- Yellow/Neutral: Minimal impact

#### 7.3 Aggregate Impact

Show combined effect if all open orders execute:

| Asset Class | Current % | After All Orders | Target % |
|-------------|-----------|------------------|----------|
| Stocks: Tech | 18% | 19.5% | 20% |

**API Endpoints:**
```
GET    /api/orders                  - Fetch open orders from IBKR
GET    /api/orders/impact           - Calculate allocation impact
```

---

### 8. Options Opportunity Scanner

**Purpose:** Analyze options market data to find opportunities for underinvested asset classes.

**UI Location:** "Opportunities" or "Options Scanner" page

#### 8.1 Scanner Parameters

User-configurable criteria:

```typescript
interface ScannerCriteria {
  // Asset class filter
  assetClassIds: string[];        // Which classes to scan (default: underinvested)
  onlyUnderinvested: boolean;     // Auto-select underinvested classes

  // Expiration filters
  minDaysToExpiration: number;    // e.g., 30
  maxDaysToExpiration: number;    // e.g., 60

  // Greeks filters
  minDelta: number;               // e.g., 0.20 (20 delta)
  maxDelta: number;               // e.g., 0.40 (40 delta)

  // Profitability filters
  minAnnualizedReturn: number;    // e.g., 12% annualized
  minPremiumPercent: number;      // Premium / Strike (e.g., 2%)

  // Risk filters
  maxStrikePercent: number;       // Strike as % of current price (e.g., 90%)
  minOpenInterest: number;        // Liquidity filter
  minImpliedVolatility?: number;  // Optional IV filter
  maxImpliedVolatility?: number;

  // Strategy type
  strategyType: 'cash-secured-put' | 'covered-call' | 'both';
}
```

#### 8.2 Scanner Output

```typescript
interface OptionOpportunity {
  // Contract details
  symbol: string;
  underlying: string;
  conId: number;
  strike: number;
  expiration: Date;
  right: 'C' | 'P';

  // Pricing
  bid: number;
  ask: number;
  mid: number;
  lastPrice: number;

  // Greeks
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  impliedVolatility: number;

  // Calculated metrics
  daysToExpiration: number;
  premium: number;                 // Per contract
  premiumPercent: number;          // Premium / Strike
  annualizedReturn: number;        // Annualized premium yield
  maxProfit: number;               // Premium received
  maxLoss: number;                 // Strike × 100 - Premium (for puts)
  breakeven: number;               // Strike - Premium (for puts)

  // Context
  assetClassId: string;
  assetClassName: string;
  currentUnderlyingPrice: number;
  strikePercentFromPrice: number;  // How far OTM

  // Scoring
  opportunityScore: number;        // Composite score 0-100
}
```

#### 8.3 Scoring Algorithm

Opportunities are scored based on:

1. **Allocation Need (40%):** Higher score for more underinvested asset classes
2. **Risk-Adjusted Return (30%):** Annualized return vs. delta risk
3. **Liquidity (15%):** Open interest and bid-ask spread
4. **Days to Expiration Sweet Spot (15%):** Prefer 30-45 DTE

```typescript
function calculateOpportunityScore(opp: OptionOpportunity, allocationDeficit: number): number {
  const allocationScore = Math.min(allocationDeficit * 10, 40); // Max 40 points

  const returnScore = Math.min(opp.annualizedReturn * 1.5, 30); // Max 30 points

  const liquidityScore = calculateLiquidityScore(opp.openInterest, opp.bid, opp.ask); // Max 15

  const dteScore = calculateDTEScore(opp.daysToExpiration); // Max 15

  return allocationScore + returnScore + liquidityScore + dteScore;
}
```

#### 8.4 Opportunity Display

Table columns:
- Underlying + Strike + Expiration
- Asset Class
- Current Price / Strike Price
- Bid × Ask
- Delta
- Premium %
- Annualized Return
- DTE
- Score
- Action (Quick Trade button)

Filters:
- Asset class dropdown
- Expiration range
- Delta range
- Min return slider

Sorting:
- By score (default)
- By annualized return
- By delta
- By DTE

**API Endpoints:**
```
POST   /api/scanner/run             - Run scanner with criteria
GET    /api/scanner/criteria        - Get saved scanner criteria
PUT    /api/scanner/criteria        - Save scanner criteria
GET    /api/scanner/symbols/:assetClassId - Get symbols for asset class
```

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌────────┐ │
│  │Dashboard│ │Watchlist │ │ Positions │ │ Orders  │ │Scanner │ │
│  └────┬────┘ └────┬─────┘ └─────┬─────┘ └────┬────┘ └───┬────┘ │
│       └───────────┴─────────────┴────────────┴──────────┘       │
│                              │                                   │
│                         REST API / SSE                           │
└──────────────────────────────┼───────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────┐
│                         Backend (Node.js)                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      API Layer (Express)                    ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│  ┌──────────────────────────────┼──────────────────────────────┐│
│  │                      Service Layer                          ││
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌───────────────┐ ││
│  │  │ AssetSvc │ │AllocationS│ │ PortfolioS│ │ OptionScanner │ ││
│  │  └──────────┘ └───────────┘ └──────────┘ └───────────────┘ ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│  ┌──────────────────────────────┼──────────────────────────────┐│
│  │                      Data Layer                             ││
│  │  ┌──────────┐ ┌───────────────┐ ┌─────────────┐            ││
│  │  │ Database │ │ IBKR Service  │ │ Cache (opt) │            ││
│  │  └──────────┘ └───────────────┘ └─────────────┘            ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   TWS / IB Gateway  │
                    └─────────────────────┘
```

### Data Persistence

**Database: PostgreSQL**

PostgreSQL is used for all persistent data storage, providing:
- Robust ACID compliance for data integrity
- Excellent support for JSON/JSONB columns for flexible data
- Strong indexing capabilities for complex queries
- Connection pooling support for concurrent access
- Native UUID support for primary keys

**Connection Configuration:**
```
DATABASE_URL=postgresql://user:password@localhost:5432/assup
```

**ORM/Query Builder:** Prisma or Drizzle ORM (TypeScript-native with type safety)

**Stored Data:**
- Asset classes
- Allocation profiles and targets
- Security assignments
- Watchlists and watchlist items
- Scanner criteria presets
- Dashboard/user settings

**Not Stored (Fetched from IBKR):**
- Positions
- Orders
- Market data
- Options chains

### Database Schema

```sql
-- Asset Classes
CREATE TABLE asset_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1', -- Hex color
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allocation Profiles
CREATE TABLE allocation_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allocation Targets (join table)
CREATE TABLE allocation_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_profile_id UUID NOT NULL REFERENCES allocation_profiles(id) ON DELETE CASCADE,
  asset_class_id UUID NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  target_percentage DECIMAL(5,2) NOT NULL CHECK (target_percentage >= 0 AND target_percentage <= 100),
  UNIQUE(allocation_profile_id, asset_class_id)
);

-- Security Assignments
CREATE TABLE security_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  con_id INTEGER, -- IBKR contract ID
  sec_type VARCHAR(10) NOT NULL DEFAULT 'STK',
  asset_class_id UUID NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  source VARCHAR(20) NOT NULL DEFAULT 'position', -- 'watchlist' or 'position'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, sec_type)
);

-- Watchlists
CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Watchlist Items
CREATE TABLE watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  con_id INTEGER,
  sec_type VARCHAR(10) NOT NULL DEFAULT 'STK',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(watchlist_id, symbol)
);

-- Scanner Criteria Presets
CREATE TABLE scanner_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  criteria JSONB NOT NULL, -- Stores ScannerCriteria object
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User/Dashboard Settings
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_security_assignments_symbol ON security_assignments(symbol);
CREATE INDEX idx_security_assignments_asset_class ON security_assignments(asset_class_id);
CREATE INDEX idx_allocation_targets_profile ON allocation_targets(allocation_profile_id);
CREATE INDEX idx_watchlist_items_watchlist ON watchlist_items(watchlist_id);
```

### Database Migrations

Migrations are managed using Prisma Migrate or a similar tool:

```bash
# Generate migration from schema changes
npx prisma migrate dev --name <migration_name>

# Apply migrations in production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Docker Compose Database Service

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: assup
      POSTGRES_PASSWORD: ${DB_PASSWORD:-assup_dev}
      POSTGRES_DB: assup
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U assup"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

### Real-time Updates

**Server-Sent Events (SSE):**
- Connection status (existing)
- Position updates
- Order status changes
- Market data for watchlist

**Polling (Fallback):**
- Dashboard refresh (configurable interval)
- Options chain data (on-demand)

---

## UI/UX Design Guidelines

### Navigation Structure

```
┌─────────────────────────────────────────────────┐
│ [Logo] Dashboard | Positions | Watchlist | Orders | Scanner | Settings │
└─────────────────────────────────────────────────┘
```

### Dashboard Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Portfolio Summary                                             │
│ Total Value: $250,000  |  Today: +$1,234 (+0.5%)            │
│ [Include Options Toggle]                                      │
├──────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐  ┌─────────────────────────────────┐ │
│ │                     │  │ Allocation Table                │ │
│ │    Pie Chart        │  │ Asset Class | Target | Current  │ │
│ │                     │  │ Tech        | 20%    | 18% ▼    │ │
│ │                     │  │ Bonds       | 25%    | 28% ▲    │ │
│ └─────────────────────┘  └─────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Underinvested Classes                                         │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ Tech: -2% ($5,000 needed)  [Find Opportunities →]       │  │
│ │ Nuclear: -1.5% ($3,750 needed)  [Find Opportunities →]  │  │
│ └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Color Scheme

- **Under allocation:** Red/Orange shades
- **Over allocation:** Blue/Purple shades
- **On target:** Green
- **Neutral:** Gray

---

## Implementation Phases

### Phase 1: Foundation
- Asset class CRUD
- Allocation profile management
- Basic database setup
- API structure

### Phase 2: Portfolio Integration
- IBKR positions fetching
- Security assignment system
- Basic dashboard with allocation view

### Phase 3: Watchlist & Orders
- Watchlist management
- Orders view with impact analysis
- Real-time updates via SSE

### Phase 4: Options Integration
- Options toggle in dashboard
- Options position handling
- Delta-weighted calculations

### Phase 5: Options Scanner
- Options chain fetching
- Scanner criteria configuration
- Opportunity scoring and display

### Phase 6: Polish & Optimization
- Performance optimization
- UI refinements
- Export/reporting features

---

## Appendix: API Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/asset-classes` | GET, POST | List/Create asset classes |
| `/api/asset-classes/:id` | PUT, DELETE | Update/Delete asset class |
| `/api/allocations` | GET, POST | List/Create allocation profiles |
| `/api/allocations/:id` | PUT, DELETE | Update/Delete allocation |
| `/api/allocations/:id/activate` | PUT | Set active allocation |
| `/api/assignments` | GET, POST | List/Create security assignments |
| `/api/assignments/:symbol` | GET, DELETE | Get/Remove assignment |
| `/api/watchlists` | GET, POST | List/Create watchlists |
| `/api/watchlists/:id` | PUT, DELETE | Update/Delete watchlist |
| `/api/watchlists/:id/items` | POST | Add item to watchlist |
| `/api/watchlists/:id/items/:symbol` | DELETE | Remove item |
| `/api/positions` | GET | Fetch positions from IBKR |
| `/api/positions/summary` | GET | Positions aggregated by class |
| `/api/orders` | GET | Fetch open orders |
| `/api/orders/impact` | GET | Calculate order impact |
| `/api/dashboard/allocation` | GET | Current allocation status |
| `/api/dashboard/settings` | GET, PUT | Dashboard preferences |
| `/api/scanner/run` | POST | Run options scanner |
| `/api/scanner/criteria` | GET, PUT | Scanner criteria presets |
| `/api/connection/status` | GET (SSE) | TWS connection status |
