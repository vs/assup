# Profit & Loss Calculations in Assup

This document describes how Assup calculates cost basis, profit/loss, and related values for stocks and options. There are two main contexts where these calculations appear:

1. **Profit Page** - Monthly profit tracking for portfolio performance
2. **Taxes Page** - Annual tax reporting with FIFO lot matching and CZK conversion

## Table of Contents

- [Data Sources](#data-sources)
- [Profit Page Calculations](#profit-page-calculations)
  - [Options Profit](#options-profit)
  - [Stock Profit](#stock-profit)
  - [Assignment Detection and Handling](#assignment-detection-and-handling)
  - [Cash Transactions](#cash-transactions)
- [Taxes Page Calculations](#taxes-page-calculations)
  - [Stock Trades with FIFO](#stock-trades-with-fifo)
  - [Option Trades with FIFO](#option-trades-with-fifo)
  - [Corporate Actions](#corporate-actions)
  - [Dividend Taxation](#dividend-taxation)
  - [Currency Conversion](#currency-conversion)
- [Key Differences Between Pages](#key-differences-between-pages)
- [Edge Cases](#edge-cases)

---

## Data Sources

Assup uses two primary data sources:

1. **IBKR FLEX Reports** - Historical trades imported via CSV/XML with IBKR-calculated `costBasis` and `realizedPnl` fields
2. **TWS Real-time API** - Today's executions fetched directly from TWS (IDs prefixed with `tws-`)

The system prefers IBKR's authoritative values when available, falling back to manual calculations when needed.

---

## Profit Page Calculations

The Profit page shows monthly realized P&L from options, stocks, dividends, interest, and fees.

### Options Profit

#### Cost Basis Determination

**Short Options (SELL to open):**
```
costBasis = sum of |proceeds| from all open trades (premium received)
```

**Long Options (BUY to open):**
```
costBasis = sum of |proceeds| from all open trades (premium paid)
```

#### Profit Calculation

**Short positions:**
```
profit = costBasis - sellPrice - commissions
       = (premium received) - (cost to close) - (commissions)
```

**Long positions:**
```
profit = sellPrice - costBasis - commissions
       = (proceeds from close) - (premium paid) - (commissions)
```

#### Sell Price Determination

| Scenario | Sell Price |
|----------|------------|
| Closed normally | Sum of absolute proceeds from close trades |
| Expired worthless | 0 |
| Assigned | 0 (P&L moved to stock position) |
| Still open | 0 (no realized P&L) |

#### FIFO Matching for Partial Fills

When multiple fills exist for the same contract, FIFO matching pairs opens with closes:

1. Calculate per-contract price for each open: `|proceeds| / |quantity|`
2. For each close trade, match against oldest open trades first
3. Sum matched cost basis for the realized portion
4. Unmatched open quantities don't contribute to realized P&L

#### Missing Open Trades

When the FLEX report period doesn't include the opening trade but has a closing trade:

1. Use IBKR's `realizedPnl` directly (authoritative source)
2. Derive cost basis: `costBasis = |proceeds + realizedPnl|`
3. Fall back to IBKR's `costBasis` field if `realizedPnl` unavailable

### Stock Profit

Stock profit calculations primarily rely on IBKR's authoritative data:

```
profit = realizedPnl (from IBKR FLEX report)
costBasis = sell.costBasis ?? (sellProceeds - realizedPnl)
```

**For real-time TWS trades** (not yet in FLEX reports), cost basis is calculated using FIFO from historical BUY trades in the database.

#### Monthly Attribution

- **Options:** Attributed to the month of close date or expiry date (whichever applies)
- **Stocks:** Attributed to the month of the sell date
- **Expiry timing:** Options expiring today are NOT marked expired until the next business day (settlement)

### Assignment Detection and Handling

#### How Assignments Are Detected

An option is marked as assigned when:

1. **Early Assignment:** Close trade exists with price ≤ $0.01 before expiry
2. **Expiration Assignment:** Expiry has passed
3. **Stock Trade Match:** Found within search window with:
   - Symbol matches underlying
   - Direction matches (PUT assignment → stock BUY, CALL assignment → stock SELL)
   - Price within 2% of strike
   - Quantity within 10% of expected shares (contracts × 100)

**Search Window:**
- For early assignments: 1 day before to 5 days after close trade date
- For expiration assignments: Expiry date to 5 days after

#### Assignment Premium Adjustment

**Only applied to real-time TWS trades** (FLEX imports already have correct `realizedPnl`):

When a stock is acquired via PUT assignment:
```
stockProfit += PUT premium received
stockCostBasis -= PUT premium received
```

This reflects that the effective purchase price is reduced by the premium collected.

### Cash Transactions

| Type | Source | Sign |
|------|--------|------|
| Dividends | FLEX "DIVIDEND" transactions | Positive |
| Interest | FLEX "INTEREST" transactions | Positive |
| Withholding Tax | FLEX "WITHHOLDING" transactions | Negative |
| Fees | FLEX "FEE" transactions | Negative |

All amounts are converted to USD using CNB exchange rates when needed.

---

## Taxes Page Calculations

The Taxes page provides detailed lot-level tracking for Czech tax reporting, with separate USD and CZK columns.

### Stock Trades with FIFO

#### FIFO Algorithm

1. Get all SELL trades for a symbol (chronologically)
2. Get all BUY trades as "lots" with:
   - Original and remaining quantity
   - Cost basis in USD (including commission)
   - Exchange rate on trade date
   - Cumulative split multiplier
3. For each SELL (chronologically):
   - Consume from oldest lots first
   - Track exempt vs. taxable portions separately

#### Holding Period Calculation

```
holdingDays = (sellDate - buyDate) / (1000 × 60 × 60 × 24)
exempt = holdingDays >= (3 × 365)  // 3-year exemption in Czech tax law
```

#### Exempt vs. Taxable Splitting

When a single sell consumes lots with different holding periods:
- **Exempt portion** (3+ years): Separate record with `-exempt` suffix
- **Taxable portion** (<3 years): Separate record with `-taxable` suffix

### Option Trades with FIFO

#### Open Trade Discovery

Three-level matching strategy:

1. **Exact match:** Same symbol + `openClose = "O"`
2. **conId fallback:** Use IBKR contract ID if symbol doesn't match
3. **Relaxed match:** Same underlying + expiry + right with strike tolerance (2% or $1)

#### Close Type Determination

| Condition | Close Type |
|-----------|------------|
| `wasAssigned = true` | "assigned" |
| `proceeds = 0` and `costBasis > 0` | "assigned" |
| `proceeds = 0` and `costBasis = 0` | "expired" |
| Otherwise | "closed" |

#### Czech Tax Income/Expense Rules

**Short positions (selling premium):**
```
income = premium received (from open)
expense = cost to close (if closed, else 0)
```

**Long positions (buying premium):**
```
expense = premium paid (from open)
income = proceeds from close (if closed, else 0)
```

### Corporate Actions

#### Stock Splits

Handled in lot tracing:

1. Process splits chronologically after buys
2. Only apply to lots with remaining shares
3. Adjust quantity tracking: `qty *= splitRatio`
4. Cost basis remains unchanged (total cost doesn't change)
5. Per-share cost decreases proportionally

**Example:** 100 shares @ $50 → 10:1 split → 1000 shares @ $5 (same $5000 total cost)

#### Ticker Changes

- Informational entry in lot trace
- No quantity adjustment needed
- Uses `conId` for matching when symbol changes (e.g., ZOK → QZEU)

### Dividend Taxation

#### Processing

1. Aggregate dividends by symbol + date (handles reversals)
2. Extract country from ISIN in description (first 2 chars)
3. Pair with withholding tax transactions
4. Convert to CZK using transaction date rate

#### Output Fields

| Field | Description |
|-------|-------------|
| `grossUsd` | Dividend amount before withholding |
| `withholdingTaxUsd` | Tax withheld (stored negative, displayed positive) |
| `netUsd` | `grossUsd - withholdingTaxUsd` |
| `grossCzk` | Gross converted at transaction date rate |
| `country` | Source country from ISIN |

### Currency Conversion

#### CNB Exchange Rates

All non-USD amounts are converted using Czech National Bank rates:

```
amountCzk = amountUsd × rateCzkPerUsd
```

Where `rateCzkPerUsd` is the CZK/USD rate on the relevant date.

#### Rate Selection

| Value | Rate Date |
|-------|-----------|
| Cost basis | Open trade date |
| Proceeds | Close/sell trade date |
| Dividends | Payment date |

---

## Key Differences Between Pages

| Aspect | Profit Page | Taxes Page |
|--------|-------------|------------|
| **Purpose** | Performance tracking | Tax reporting |
| **Currency** | USD only | USD + CZK columns |
| **Exchange Rates** | Single conversion | Separate open/close rates |
| **Holding Period** | Not tracked | 3-year exemption tracked |
| **Stock P&L** | IBKR `realizedPnl` | IBKR `realizedPnl` |
| **Option P&L** | Manual FIFO | Manual FIFO |
| **Grouping** | By month | By symbol + year |
| **Corporate Actions** | Not displayed | Shown in lot trace |
| **Missing Data** | Shows $0 profit | Blocks export, flagged |

---

## Edge Cases

### Early Assignment

Options can be assigned before expiry (e.g., deep ITM puts near expiry):
- Detected by close trade at $0 before expiry date
- Assignment date = close trade date (not expiry)
- Stock trade search starts from close date

### Partial Fills

- **Options:** FIFO matching per contract across all fills
- **Stocks:** Uses IBKR's aggregated `realizedPnl` (no manual partial matching)

### Missing Open Trades

**In Profit Page:**
- Use IBKR's `realizedPnl` if available
- Show trade with calculated values

**In Taxes Page:**
- Mark as "missing_open" status
- Cannot calculate CZK values without open date's exchange rate
- Blocks CSV export until resolved

### Missing Buy Trades (Stocks)

**In Taxes Page:**
- Create "missing_buy" record
- Proceeds calculated but no cost basis
- User must resolve (often from pre-import period)

### Stock Splits Impact

| What Changes | What Stays Same |
|--------------|-----------------|
| Share quantity (×ratio) | Total cost basis |
| Per-share price (÷ratio) | Holding period |
| FIFO lot tracking | Trade records |

### Unrealized P&L (Current Month View)

For open positions expiring in the current/next month:

**Short options:**
```
unrealizedPnl = costBasis + marketValue
              = (premium received) - |current liability|
```

**Long options:**
```
unrealizedPnl = marketValue - costBasis
              = (current value) - (premium paid)
```

**Projected profit** (if expires worthless):
- Short: Keep entire premium = `costBasis`
- Long: Lose entire premium = 0
