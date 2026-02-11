# Interactive Brokers Setup Guide

## TWS Configuration

Before using Assup, configure TWS:

1. **Enable API Access**
   - Edit → Global Configuration → API → Settings
   - Enable "ActiveX and Socket Clients"
   - Port: `7497` (Paper Trading) or `7496` (Live)
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

| Field Name in IBKR | Required | Purpose |
|--------------------|----------|---------|
| TradeID | Yes | Deduplication, prevents duplicate imports |
| Symbol | Yes | Security identifier |
| Description | No | Human-readable name |
| Conid | No | IBKR contract ID |
| Asset Category | Yes | Determines security type (STK, OPT, etc.) |
| Strike | Yes* | Option strike price |
| Expiry | Yes* | Option expiration date |
| Put/Call | Yes* | Option type (P or C) |
| Underlying Symbol | Yes* | Underlying for options |
| Multiplier | No | Contract multiplier (defaults to 100) |
| Trade Date | Yes | Execution date |
| Quantity | Yes | Number of shares/contracts |
| Trade Price | Yes | Execution price |
| Proceeds | Yes | Total cash amount |
| Comm/Fee | Yes | Commission and fees |
| Buy/Sell | Yes | Trade direction |
| Open/Close | Yes | Position opening or closing |
| Cost Basis | Yes | IBKR's cost basis (for taxes) |
| Realized P/L | Yes | IBKR's FIFO realized P&L (for taxes) |
| Currency | Yes | Trade currency (for taxes) |

*Required for options trading

#### Cash Transactions Section

| Field Name in IBKR | Required | Purpose |
|--------------------|----------|---------|
| Transaction ID | Yes | Deduplication |
| Type | Yes | Transaction category |
| Symbol | No | Related security |
| Description | Yes | Contains ISIN for country identification |
| Date/Time | Yes | Transaction date |
| Amount | Yes | Transaction amount |
| Currency | Yes | Currency code |

**Included transaction types:** Dividends, Interest, Withholding Tax, Fees

**Automatically filtered out:** Deposits, Withdrawals, Transfers, Forex conversions

### Output Settings

| Setting | Value |
|---------|-------|
| Date Period | Your desired range (e.g., Last 365 Days, or specific tax year) |
| Format | **XML** (recommended) or **CSV** |
| Include Headers | Yes (if using CSV) |

### Running and Importing

**Run the Query:**
1. In Account Management → Flex Queries, click **Run** next to your query
2. Download the file

**Import into Assup:**
1. Go to **Profit** page
2. Click **Import**
3. Select your downloaded file
4. Review parsed data and confirm

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

**Currency Conversion (Taxes):**
- Non-CZK amounts are converted using CNB exchange rates for the trade date
- Both USD and EUR rates are fetched automatically
