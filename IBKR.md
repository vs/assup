# Interactive Brokers Setup Guide

## TWS Configuration

Before using Assup, configure TWS:

1. **Enable API Access**
   - Edit → Global Configuration → API → Settings
   - Enable "ActiveX and Socket Clients"
   - Port: `7496` for live trading, `7497` for paper trading (set `IB_PORT` to match)
   - Disable "Read-Only API" if trading is required

2. **Add Trusted IPs**
   - Add `127.0.0.1` to Trusted IPs
   - Add `host.docker.internal` if running via Docker

## FLEX Query Configuration

The Profit and Taxes pages require importing FLEX reports from IBKR. This section explains how to create a single FLEX query that works for both features.

### Creating the FLEX Query

1. Log into **IBKR Account Management** at https://www.interactivebrokers.com
2. Navigate to **Performance & Reports** → **Flex Queries**
3. Click **Create** under "Activity Flex Queries"
4. Name it (e.g., "Assup Import")

### Required Fields

Configure the following sections in your FLEX query:

#### Trades Section

Select these fields in your FLEX query (exact names as shown in IBKR):

| Field | Required | Purpose |
|-------|----------|---------|
| Trade ID | No | Deduplication (auto-generated if missing) |
| Symbol | Yes | Security identifier |
| Description | No | Human-readable name |
| Conid | No | IBKR contract ID |
| AssetClass | Yes | Determines security type (STK, OPT, etc.) |
| Strike | Yes* | Option strike price |
| Expiry | Yes* | Option expiration date |
| Put/Call | Yes* | Option type (P or C) |
| UnderlyingSymbol | Yes* | Underlying for options |
| Multiplier | No | Contract multiplier (defaults to 100) |
| TradeDate | Yes | Execution date |
| Quantity | Yes | Number of shares/contracts |
| TradePrice | Yes | Execution price |
| Proceeds | Yes | Total cash amount |
| IBCommission | Yes | Commission and fees |
| Buy/Sell | Yes | Trade direction |
| Open/CloseIndicator | Yes | Position opening or closing |
| CostBasis | Yes | IBKR's cost basis (for taxes) |
| FifoPnlRealized | Yes | IBKR's FIFO realized P&L (for taxes) |
| CurrencyPrimary | Yes | Trade currency (for taxes) |

*Required for options trading

#### Cash Transactions Section

Select these fields in your FLEX query (exact names as shown in IBKR):

| Field | Required | Purpose |
|-------|----------|---------|
| TransactionID | No | Deduplication (auto-generated if missing) |
| Type | Yes | Transaction category (Dividends, Withholding Tax, etc.) |
| Symbol | No | Related security |
| Description | Yes | Contains ISIN for country identification |
| Date/Time | Yes | Transaction date |
| Amount | Yes | Transaction amount |
| CurrencyPrimary | Yes | Currency code |

**Included transaction types:** Dividends, Interest, Withholding Tax, Fees

**Also imported (for Account History):** Deposits, Withdrawals — stored separately as fund flows for the Account Value chart on the Dashboard. These do not affect P&L calculations.

**Automatically filtered out:** Internal Transfers, Forex conversions

#### Corporate Actions Section

Corporate actions are essential for accurate FIFO lot tracking. Without them, stock splits will cause position mismatches (e.g., you bought 10 shares, but now hold 100 after a 10:1 split).

Select these fields in your FLEX query:

| Field | Required | Purpose |
|-------|----------|---------|
| ActionID | Yes | Unique identifier for deduplication |
| Symbol | Yes | Security symbol |
| Description | Yes | Contains split ratio (e.g., "SPLIT 10 FOR 1") |
| Conid | No | IBKR contract ID |
| Type | Yes | Action type code (see below) |
| Date/Time | Yes | Effective date of the action |
| Quantity | Yes | Shares received/removed |
| Value | No | Cash value (usually 0 for splits) |

**Action Types:**
| Code | Description |
|------|-------------|
| FS | Forward Split (e.g., 10:1 - you get more shares) |
| RS | Reverse Split (e.g., 1:10 - shares consolidated) |
| SD | Stock Dividend (shares issued as dividend) |
| TC | Ticker/Symbol Change |
| SO | Spin-Off |

**Example:** For a 10:1 stock split on 10 shares:
- Type: `FS`
- Quantity: `90` (new shares received)
- Description: `SPLIT 10 FOR 1`

#### Equity Summary Section (Optional)

Enable this section to track your account value (NLV) over time on the Dashboard's Account Value chart.

In your FLEX query, enable the **Equity Summary in Base** section. Required fields:

| Field | Required | Purpose |
|-------|----------|---------|
| Report Date | Yes | Business day |
| Total | Yes | End-of-day net liquidation value in base currency |

**Notes:**
- XML format required for this section (CSV not supported)
- If this section is not included, FLEX imports still work — the Account Value chart will simply show no data
- Daily granularity provides the best chart resolution

### Output Settings

| Setting | Value |
|---------|-------|
| Date Period | Your desired range (e.g., Last 365 Days, or specific tax year) |
| Format | **XML** (recommended) |
| Include Headers | Yes (if using CSV) |

**Why XML?** XML format preserves the document structure reliably. CSV exports can have parsing issues if column order changes between FLEX query configurations.

### Running and Importing

**Run the Query:**
1. In Account Management → Flex Queries, click **Run** next to your query
2. Download the file

**Import into Assup:**
1. Go to **Settings → Imports**
2. Click **Import File**
3. Select your downloaded file
4. Review parsed data and confirm

**Automatic import (FLEX Web Service):**
1. In Account Management, open **Flex Queries → Flex Web Service Configuration** and generate a token
2. In Assup, go to **Settings → Imports → Auto-Import (FLEX Web Service)**
3. Enter the token and your query's **Query ID**, then choose a schedule
4. Set `SCHEDULER_ENABLED=true` in the backend environment so scheduled imports run

Deduplication means re-importing overlapping periods is safe.

The same imported data is used by both Profit and Taxes pages.

### How Data is Processed

**Trades:**
- Options and stock trades are parsed with full position details
- Partial fills are aggregated automatically
- Option assignments are detected by matching stock trades near expiry at strike price
- Duplicates are prevented via TradeID

**Cash Transactions:**
- Dividends and interest are tracked per symbol
- Withholding tax is matched to dividends for foreign tax credit calculations
- Source country is extracted from ISIN in the description (e.g., "US" from "USZ363198954")

**Corporate Actions:**
- Stock splits multiply lot quantities while preserving total cost basis
- Split ratio is parsed from description (e.g., "SPLIT 10 FOR 1" → ratio 10)
- Only splits occurring AFTER the buy date affect that lot
- Ticker changes are handled via conId matching (same contract, different symbol)

**Currency Conversion (Taxes):**
- Non-CZK amounts are converted using CNB exchange rates for the trade date
- Both USD and EUR rates are fetched automatically

**Fund Flows:**
- Deposits and withdrawals are stored separately from P&L data
- Internal transfers between sub-accounts are excluded (they don't change total account value)
- Used for the Account Value chart markers on the Dashboard

**Equity Summary:**
- Daily NLV snapshots are stored with upsert semantics (re-importing updates existing dates)
- Powers the Account Value chart on the Dashboard

### Troubleshooting

**"Missing buy" errors in Taxes page:**
1. **Ticker changed:** The stock may have changed symbols (e.g., FB → META). Ensure both the old and new ticker trades are imported. The system uses conId to match trades across ticker changes.
2. **Stock split not imported:** If you bought 10 shares but sold 100, import corporate actions to record the split.
3. **Buy predates your FLEX reports:** Download FLEX reports going back to when you first bought the position.

**Position mismatch in Lot Trace:**
- If calculated position differs from actual (e.g., 10 vs 100 shares), you likely need to import a stock split corporate action.
- Re-run your FLEX query with the Corporate Actions section enabled.

**Assignment not detected:**
- Assignments are detected by matching stock trades near option expiry at strike price
- Ensure both option and stock trades are in the imported data
- Stock trade must occur within 5 days of option expiry
