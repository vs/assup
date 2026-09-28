# Profit & Loss Calculations in Assup

This document describes how Assup calculates cost basis, profit/loss, and related values for stocks and options. There are two main contexts where these calculations appear:

1. **Profit Page** - Monthly profit tracking for portfolio performance
2. **Taxes Page** - Annual tax reporting with FIFO lot matching and CZK conversion for Czech taxes

> **Important:** The Profit Page and Taxes Page use different calculation methods, particularly for option assignments. This is intentional—the Profit Page follows IBKR's US-style accounting for performance tracking, while the Taxes Page follows Czech tax law (ZDP) requirements.

## Table of Contents

- [Data Sources](#data-sources)
- [Profit Page Calculations](#profit-page-calculations)
  - [Options Profit](#options-profit)
  - [Stock Profit](#stock-profit)
  - [Assignment Detection and Handling](#assignment-detection-and-handling)
  - [Cash Transactions](#cash-transactions)
- [Taxes Page Calculations](#taxes-page-calculations)
  - [Czech Tax Compliance Notes](#czech-tax-compliance-notes)
  - [Income Basket Separation](#income-basket-separation)
  - [Stock Trades with FIFO](#stock-trades-with-fifo)
  - [Option Trades with FIFO](#option-trades-with-fifo)
  - [Assigned Options and Stock Basis](#assigned-options-and-stock-basis)
  - [Tax Exemptions](#tax-exemptions)
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

The Taxes page provides detailed lot-level tracking for Czech tax reporting, with separate USD and CZK columns. This section follows Czech Income Tax Act (ZDP) requirements.

### Czech Tax Compliance Notes

> **Critical:** The Taxes Page calculations differ from the Profit Page in several important ways to comply with Czech tax law. Using IBKR's US-style values directly for Czech taxes can lead to **double taxation** or **accidental tax evasion**.

Key differences from US/IBKR accounting:
- Option premiums are always taxed as derivative income (never merged into stock basis)
- Securities and derivatives are separate "baskets" that cannot offset each other
- The 3-year holding exemption applies only to securities, never to derivatives
- Currency conversion uses CNB daily rates (§ 38 ZDP)

### Income Basket Separation

Czech tax practice requires separating income types within § 10 (Other Income):

| Basket | Includes | Notes |
|--------|----------|-------|
| **Securities** | Stocks, ETFs | Eligible for 3-year and 100k CZK exemptions |
| **Derivatives** | Options, futures | Never eligible for time-based exemptions |

**Important:** Losses from one basket generally cannot offset profits from another. For example, option losses cannot reduce tax owed on stock profits. The Taxes Page export separates these categories—do not net them together without consulting a tax advisor.

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
exempt = holdingDays >= (3 × 365)  // 3-year Time Test (§ 4 odst. 1 písm. w ZDP)
```

#### Exempt vs. Taxable Splitting

When a single sell consumes lots with different holding periods:
- **Exempt portion** (3+ years): Separate record with `-exempt` suffix
- **Taxable portion** (<3 years): Separate record with `-taxable` suffix

> **Note:** The 3-year exemption only applies to securities (stocks/ETFs). Option income is NEVER exempt regardless of holding period.

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

### Assigned Options and Stock Basis

> **Critical: Avoiding Double Taxation**
>
> IBKR's FLEX reports use US tax rules which **adjust** the stock cost basis by the option premium:
> - PUT assignment: IBKR reduces stock cost basis by premium received
> - CALL assignment: IBKR increases stock sale proceeds by premium received
>
> If Assup reports the premium as taxable option income (correct for Czech taxes) AND uses IBKR's adjusted stock basis, the premium would be **taxed twice**.

#### The Problem (Example)

```
You sell a PUT for $100 premium, strike $50. You are assigned.
Later you sell the stock for $51.

WRONG approach (using IBKR values):
  Option income: $100 (premium)
  Stock cost basis: $4,900 (IBKR adjusts: $5,000 - $100)
  Stock proceeds: $5,100
  Stock profit: $5,100 - $4,900 = $200
  Total taxable: $100 + $200 = $300  ← DOUBLE TAXATION!

CORRECT approach (for Czech taxes):
  Option income: $100 (premium) - reported as derivative
  Stock cost basis: $5,000 (Strike × Quantity - actual cash paid)
  Stock proceeds: $5,100
  Stock profit: $5,100 - $5,000 = $100
  Total taxable: $100 (derivative) + $100 (security) = $200  ← CORRECT
```

#### Taxes Page Assignment Handling

For the Taxes Page, Assup uses **unadjusted values** for assigned stock trades:

| Value | Calculation | Rationale |
|-------|-------------|-----------|
| **Stock Cost Basis** | Strike × Quantity | Actual cash paid for shares |
| **Stock Sale Proceeds** | Sale Price × Quantity | Actual cash received |
| **Option Premium** | Reported separately | Taxed as derivative income |

This ensures the option premium is taxed exactly once, as derivative income.

#### Time Test Trap

> **Warning:** Never merge option premium into stock basis to "hide" it in a 3-year exempt stock sale. Option income **never** qualifies for the time test exemption. Doing so constitutes tax evasion.

### Tax Exemptions

Czech tax law provides two exemptions for securities (§ 4 odst. 1 písm. w ZDP):

#### 1. Time Test (3-Year Holding Period)

Securities held for 3+ years are exempt from taxation:
```
exempt = holdingDays >= (3 × 365)
```

**Applies to:** Stocks, ETFs
**Does NOT apply to:** Options, futures, or any derivatives

#### 2. Value Test (100,000 CZK Threshold)

If total **gross proceeds** (příjmy) from all securities sold in the tax year are below 100,000 CZK, all security income is exempt regardless of holding period or profit.

```
totalGrossProceeds = sum of all stock sale proceeds in CZK
exempt = totalGrossProceeds < 100,000
```

**Important:** This is gross proceeds (total sale value), not profit. The Taxes Page export includes total gross proceeds to help identify if this exemption applies.

**Applies to:** Securities only (stocks, ETFs)
**Does NOT apply to:** Derivatives (options)

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
- Uses `conId` for matching when symbol changes (e.g., FB → META)

### Dividend Taxation

#### Processing

1. Aggregate dividends by symbol + date (handles reversals)
2. Extract country from ISIN in description (first 2 chars)
3. Pair with withholding tax transactions
4. Convert to CZK using transaction date rate

#### Output Fields (Required for Czech Tax Return)

The following fields are required for the Czech tax return (Příloha č. 3 or separate sheet):

| Field | Description | Tax Form Use |
|-------|-------------|--------------|
| `grossUsd` | Dividend amount before withholding | Include in § 8 tax base |
| `grossCzk` | Gross converted at payment date rate | CZK value for tax base |
| `withholdingTaxUsd` | Tax withheld at source | Used for foreign tax credit |
| `withholdingTaxCzk` | Withholding in CZK | Credit calculation |
| `country` | Source country from ISIN | Determines treaty limits |

> **Important:** Do not use "net dividend" for tax reporting. Czech tax returns require:
> 1. **Gross dividend** (hrubá dividenda) - the full amount before any withholding
> 2. **Tax paid abroad** (daň zaplacená v zahraničí) - for credit calculation
> 3. **Source country** - to apply correct treaty limit (typically 15% for US/CZ treaty)

#### Foreign Tax Credit Limit

The credit for foreign withholding tax is limited by the applicable tax treaty:
- **US dividends:** Max 15% credit (US/CZ treaty)
- **Other countries:** Check specific treaty

If the foreign withholding exceeds the treaty limit, only the treaty limit can be credited.

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
| **Purpose** | Performance tracking | Czech tax reporting (ZDP) |
| **Currency** | USD only | USD + CZK columns |
| **Exchange Rates** | Single conversion | Separate open/close rates (CNB daily) |
| **Holding Period** | Not tracked | 3-year exemption tracked |
| **Value Test** | Not tracked | 100k CZK exemption tracked |
| **Stock P&L** | IBKR `realizedPnl` | Manual FIFO (unadjusted basis) |
| **Option P&L** | Manual FIFO | Manual FIFO |
| **Assignment Handling** | Premium merged into stock | Premium separate (derivative income) |
| **Assigned Stock Basis** | IBKR adjusted basis | Strike × Quantity (actual cash) |
| **Income Separation** | Combined total | Securities vs. Derivatives split |
| **Grouping** | By month | By symbol + year |
| **Corporate Actions** | Not displayed | Shown in lot trace |
| **Missing Data** | Shows $0 profit | Blocks export, flagged |
| **Dividend Reporting** | Net amount | Gross + withholding separate |

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
