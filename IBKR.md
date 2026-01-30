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
