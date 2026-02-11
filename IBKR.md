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

## FLEX Query Report (for Trade Import)

### Create FLEX Query (one-time setup)

1. **Log into Account Management** (not TWS itself)
   - Go to https://www.interactivebrokers.com
   - Log in → **Performance & Reports** → **Flex Queries**

2. **Create a new Activity Flex Query**
   - Click **Create** under "Activity Flex Queries"
   - Give it a name like "Options Trades for Assup"

3. **Configure the query sections:**

   **Trades** - Select these fields:
   - Symbol, Description, Asset Category, Underlying Symbol
   - Trade Date, Quantity, Trade Price, Proceeds, Commission
   - Put/Call, Strike, Expiry
   - Open/Close Indicator
   - Cost Basis, Realized P&L (for stock trades with external cost basis)

   **Cash Transactions** - Select these fields (for dividends & interest):
   - Type
   - Symbol
   - Description
   - Date/Time
   - Amount
   - CurrencyPrimary

   Note: Deposits, withdrawals, and currency conversions are automatically filtered out.

   Set **Date Period** to your desired range (e.g., Last 365 Days or custom)

4. **Set Output Format:**
   - Format: **CSV**
   - Include headers: **Yes**

5. **Save the query**

### Run the Query

#### Option A: From Account Management
1. Go to **Flex Queries** page
2. Click **Run** next to your query
3. Download the CSV file

#### Option B: From TWS
1. **Account** menu → **Reports** → **Flex Queries**
2. Select your query and run it
3. Save the downloaded file

### Import into Assup

1. Go to the **Profit** page in Assup
2. Click **Import** button
3. Select your downloaded CSV file
4. Review the parsed trades and confirm import

The import processes:
- **Trades**: Option and stock trades (symbol, date, quantity, price, strike, expiry, put/call, cost basis, realized P&L)
- **Cash Transactions**: Dividends, interest, withholding tax, fees (type, symbol, date, amount)

Partial fills are aggregated automatically. Duplicate imports are prevented using file hashing and trade IDs.

## FLEX Report Configuration for Tax Reporting

To use the Taxes page for Czech tax reporting, your FLEX report must include additional fields.

### Required Fields for Trades Section

Ensure your FLEX query includes these fields in the Trades section:
- `TradeDate` - Exact trade date for CNB rate lookup
- `Currency` - Trade currency (USD, EUR, etc.)
- `Symbol`, `Quantity`, `TradePrice`, `Proceeds`, `Commission`
- `CostBasis`, `RealizedPnl`
- `BuySell`, `OpenCloseIndicator`
- `SecType` - Security type (STK, OPT)
- For options: `Strike`, `Expiry`, `Right`, `Underlying`

### Required Fields for Cash Transactions

Ensure your FLEX query includes:
- `Type` - Transaction type (Dividends, Withholding Tax)
- `Currency`
- `Amount`
- `Symbol`
- `Description` - Often contains ISIN for country identification

### Country Identification for Dividends

The system extracts the dividend source country from:
1. ISIN in the description (first 2 characters, e.g., "US" from "USZ363198954")
2. Falls back to "USA" for unidentified sources

For accurate foreign tax credit reporting, ensure your FLEX report includes dividend descriptions with ISINs.

### Recommended FLEX Query Setup

1. Go to IBKR Account Management → Reports → Flex Queries
2. Create or edit your Activity FLEX Query
3. In Trades section, select all fields listed above
4. In Cash Transactions section, include Dividends and Withholding Tax
5. Set date range to cover your tax year
6. Export as CSV format
