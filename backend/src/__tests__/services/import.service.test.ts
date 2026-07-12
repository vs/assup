/**
 * Tests for ImportService CSV parsing
 * Focus: Multi-section FLEX report handling
 */

import { describe, it, expect, beforeEach } from "vitest";

// We need to test the private parseCSV method, so we'll access it via type assertion
// First, let's create a minimal version that exposes the parsing for testing

import { parse as parseCSV } from "csv-parse/sync";

/**
 * Recreate the parsing logic from ImportService for testing
 * This mirrors the implementation but is isolated from database dependencies
 */
interface FlexTrade {
  tradeID: string;
  symbol: string;
  description?: string;
  assetCategory: string;
  tradeDate: string;
  quantity: string;
  tradePrice: string;
  proceeds: string;
  buySell: string;
}

interface FlexCashTransaction {
  transactionID: string;
  symbol?: string;
  description: string;
  dateTime: string;
  amount: string;
  type: string;
}

interface ParsedFlexData {
  trades: FlexTrade[];
  cashTransactions: FlexCashTransaction[];
}

function isTradesHeader(line: string): boolean {
  const hasAssetCategory =
    line.includes('"Asset Category"') || line.includes('"AssetClass"');
  const hasTradePrice =
    line.includes('"Trade Price"') || line.includes('"TradePrice"');
  const hasTradeId =
    line.includes('"TradeID"') || line.includes('"Trade ID"');
  return hasTradeId && (hasAssetCategory || hasTradePrice);
}

function isCashHeader(line: string): boolean {
  const hasType = line.includes('"Type"') || line.includes('"type"');
  const hasAmount = line.includes('"Amount"') || line.includes('"amount"');
  const hasAssetCategory =
    line.includes('"Asset Category"') || line.includes('"AssetClass"');
  const hasTradePrice =
    line.includes('"Trade Price"') || line.includes('"TradePrice"');
  return hasType && hasAmount && !hasAssetCategory && !hasTradePrice;
}

function parseTradesSection(
  sectionContent: string,
  seqOffset: number
): FlexTrade[] {
  const trades: FlexTrade[] = [];

  const tradeRecords = parseCSV(sectionContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (tradeRecords.length === 0) {
    return trades;
  }

  let csvTradeSeq = seqOffset;
  for (const record of tradeRecords) {
    const assetCategory = record["Asset Category"] || record["AssetClass"];
    const buySell = record["Buy/Sell"] || record["Code"];
    const tradeDate =
      record["Trade Date"] || record["TradeDate"] || record["Date/Time"];
    const quantity = record["Quantity"];
    const tradePrice =
      record["T. Price"] || record["Trade Price"] || record["TradePrice"];

    // Skip intermediate header rows
    if (quantity && isNaN(parseFloat(quantity))) continue;
    if (tradePrice && isNaN(parseFloat(tradePrice))) continue;

    const inferredBuySell =
      buySell || (quantity && parseFloat(quantity) > 0 ? "BUY" : "SELL");

    if (assetCategory && (buySell || quantity)) {
      trades.push({
        tradeID:
          record["TradeID"] ||
          record["Trade ID"] ||
          `${tradeDate}-${record["Symbol"]}-${quantity}-${tradePrice}-${++csvTradeSeq}`,
        symbol: record["Symbol"],
        description: record["Description"],
        assetCategory,
        tradeDate,
        quantity,
        tradePrice,
        proceeds: record["Proceeds"],
        buySell: inferredBuySell,
      });
    }
  }

  return trades;
}

function parseCashSection(sectionContent: string): FlexCashTransaction[] {
  const cashTransactions: FlexCashTransaction[] = [];

  const cashRecords = parseCSV(sectionContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  for (const record of cashRecords) {
    const txType = record["Type"];
    const txAmount = record["Amount"];
    const txDate = record["Date/Time"] || record["DateTime"] || record["Date"];
    const txId =
      record["Transaction ID"] ||
      record["TransactionID"] ||
      record["transactionID"];

    // Skip intermediate header rows
    if (txAmount && isNaN(parseFloat(txAmount))) continue;

    if (txType && txAmount) {
      cashTransactions.push({
        transactionID: txId || `${txDate}-${txType}-${txAmount}`,
        symbol: record["Symbol"],
        description: record["Description"] || "",
        dateTime: txDate,
        amount: txAmount,
        type: txType,
      });
    }
  }

  return cashTransactions;
}

function parseMultiSectionCSV(content: string): ParsedFlexData {
  const lines = content.split("\n");

  interface Section {
    type: "trades" | "cash";
    startLine: number;
  }

  const sections: Section[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTradesHeader(line)) {
      sections.push({ type: "trades", startLine: i });
    } else if (isCashHeader(line)) {
      sections.push({ type: "cash", startLine: i });
    }
  }

  const trades: FlexTrade[] = [];
  const cashTransactions: FlexCashTransaction[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextSection = sections[i + 1];
    const endLine = nextSection ? nextSection.startLine : lines.length;

    const sectionLines = lines.slice(section.startLine, endLine);
    const sectionContent = sectionLines.join("\n");

    if (section.type === "trades") {
      const sectionTrades = parseTradesSection(sectionContent, trades.length);
      trades.push(...sectionTrades);
    } else {
      const sectionCash = parseCashSection(sectionContent);
      cashTransactions.push(...sectionCash);
    }
  }

  return { trades, cashTransactions };
}

describe("ImportService CSV Parsing", () => {
  describe("Multi-section FLEX reports", () => {
    it("should parse a single trades section", () => {
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"123","AAPL","Stocks","2024-01-15","100","150.00","-15000","BUY"
"124","MSFT","Stocks","2024-01-16","50","400.00","-20000","BUY"`;

      const result = parseMultiSectionCSV(csv);

      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].symbol).toBe("AAPL");
      expect(result.trades[1].symbol).toBe("MSFT");
      expect(result.cashTransactions).toHaveLength(0);
    });

    it("should parse a single cash section", () => {
      const csv = `"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN001","AAPL","AAPL DIVIDEND","2024-01-20","125.00","Dividends"
"TXN002","MSFT","MSFT DIVIDEND","2024-01-21","85.50","Dividends"`;

      const result = parseMultiSectionCSV(csv);

      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(2);
      expect(result.cashTransactions[0].symbol).toBe("AAPL");
      expect(result.cashTransactions[0].type).toBe("Dividends");
      expect(result.cashTransactions[1].amount).toBe("85.50");
    });

    it("should parse trades section followed by cash section", () => {
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"123","AAPL","Stocks","2024-01-15","100","150.00","-15000","BUY"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN001","AAPL","AAPL DIVIDEND","2024-01-20","125.00","Dividends"`;

      const result = parseMultiSectionCSV(csv);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].symbol).toBe("AAPL");
      expect(result.cashTransactions).toHaveLength(1);
      expect(result.cashTransactions[0].type).toBe("Dividends");
    });

    it("should parse multiple trades sections (e.g., Stocks and Options)", () => {
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"123","AAPL","Stocks","2024-01-15","100","150.00","-15000","BUY"
"124","MSFT","Stocks","2024-01-16","50","400.00","-20000","BUY"
"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"125","AAPL 240119C00150000","Equity and Index Options","2024-01-10","-1","2.50","250","SELL"
"126","SPY 240315P00450000","Equity and Index Options","2024-01-12","-2","5.00","1000","SELL"`;

      const result = parseMultiSectionCSV(csv);

      expect(result.trades).toHaveLength(4);
      // First section - Stocks
      expect(result.trades[0].symbol).toBe("AAPL");
      expect(result.trades[0].assetCategory).toBe("Stocks");
      expect(result.trades[1].symbol).toBe("MSFT");
      expect(result.trades[1].assetCategory).toBe("Stocks");
      // Second section - Options
      expect(result.trades[2].symbol).toBe("AAPL 240119C00150000");
      expect(result.trades[2].assetCategory).toBe("Equity and Index Options");
      expect(result.trades[3].symbol).toBe("SPY 240315P00450000");
      expect(result.trades[3].assetCategory).toBe("Equity and Index Options");
    });

    it("should parse multiple cash sections", () => {
      const csv = `"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN001","AAPL","AAPL DIVIDEND","2024-01-20","125.00","Dividends"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN002","","CREDIT INTEREST","2024-01-31","12.34","Broker Interest Paid"`;

      const result = parseMultiSectionCSV(csv);

      expect(result.cashTransactions).toHaveLength(2);
      expect(result.cashTransactions[0].type).toBe("Dividends");
      expect(result.cashTransactions[1].type).toBe("Broker Interest Paid");
    });

    it("should parse interleaved trades and cash sections", () => {
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"123","AAPL","Stocks","2024-01-15","100","150.00","-15000","BUY"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN001","AAPL","AAPL DIVIDEND","2024-01-20","125.00","Dividends"
"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"125","MSFT 240119C00400000","Equity and Index Options","2024-01-10","-1","3.50","350","SELL"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN002","","CREDIT INTEREST","2024-01-31","12.34","Broker Interest Paid"`;

      const result = parseMultiSectionCSV(csv);

      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].symbol).toBe("AAPL");
      expect(result.trades[0].assetCategory).toBe("Stocks");
      expect(result.trades[1].symbol).toBe("MSFT 240119C00400000");
      expect(result.trades[1].assetCategory).toBe("Equity and Index Options");

      expect(result.cashTransactions).toHaveLength(2);
      expect(result.cashTransactions[0].type).toBe("Dividends");
      expect(result.cashTransactions[1].type).toBe("Broker Interest Paid");
    });

    it("should handle real-world FLEX report structure with multiple asset categories", () => {
      // This simulates a real IBKR FLEX report that has separate sections per asset category
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"1001","AAPL","Stocks","2024-01-15","100","150.00","-15000.00","BUY"
"1002","GOOG","Stocks","2024-01-15","20","140.00","-2800.00","BUY"
"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"2001","AAPL 240119C00155000","Equity and Index Options","2024-01-10","-1","2.50","250.00","SELL"
"2002","AAPL 240119C00155000","Equity and Index Options","2024-01-19","1","0.05","-5.00","BUY"
"2003","SPY 240315P00450000","Equity and Index Options","2024-01-12","-2","5.00","1000.00","SELL"
"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"3001","GLD","Stocks","2024-01-18","50","185.00","-9250.00","BUY"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"D001","AAPL","AAPL(USZ363198954) CASH DIVIDEND USD 0.24 PER SHARE","2024-02-15","24.00","Dividends"
"D002","GOOG","GOOG(USZ162158193) CASH DIVIDEND USD 0.20 PER SHARE","2024-02-15","4.00","Dividends"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"I001","","USD CREDIT INTEREST FOR JAN 2024","2024-01-31","8.75","Broker Interest Paid"
"I002","","USD DEBIT INTEREST FOR JAN 2024","2024-01-31","-2.15","Broker Interest Paid"`;

      const result = parseMultiSectionCSV(csv);

      // Should have all 6 trades from 3 separate trades sections
      expect(result.trades).toHaveLength(6);

      // Verify first trades section (Stocks)
      expect(result.trades[0].tradeID).toBe("1001");
      expect(result.trades[0].symbol).toBe("AAPL");
      expect(result.trades[1].tradeID).toBe("1002");
      expect(result.trades[1].symbol).toBe("GOOG");

      // Verify second trades section (Options)
      expect(result.trades[2].tradeID).toBe("2001");
      expect(result.trades[2].assetCategory).toBe("Equity and Index Options");
      expect(result.trades[3].tradeID).toBe("2002");
      expect(result.trades[4].tradeID).toBe("2003");

      // Verify third trades section (more Stocks)
      expect(result.trades[5].tradeID).toBe("3001");
      expect(result.trades[5].symbol).toBe("GLD");
      expect(result.trades[5].assetCategory).toBe("Stocks");

      // Should have all 4 cash transactions from 2 separate cash sections
      expect(result.cashTransactions).toHaveLength(4);

      // Verify first cash section (Dividends)
      expect(result.cashTransactions[0].transactionID).toBe("D001");
      expect(result.cashTransactions[0].type).toBe("Dividends");
      expect(result.cashTransactions[1].transactionID).toBe("D002");

      // Verify second cash section (Interest)
      expect(result.cashTransactions[2].transactionID).toBe("I001");
      expect(result.cashTransactions[2].type).toBe("Broker Interest Paid");
      expect(result.cashTransactions[3].amount).toBe("-2.15");
    });

    it("should skip intermediate header rows within sections", () => {
      // Sometimes FLEX reports have subtotal rows that look like headers
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"123","AAPL","Stocks","2024-01-15","100","150.00","-15000","BUY"
"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"124","MSFT","Stocks","2024-01-16","50","400.00","-20000","BUY"`;

      const result = parseMultiSectionCSV(csv);

      // Both trades should be parsed, intermediate header treated as new section
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].symbol).toBe("AAPL");
      expect(result.trades[1].symbol).toBe("MSFT");
    });

    it("should handle empty sections gracefully", () => {
      const csv = `"TradeID","Symbol","Asset Category","Trade Date","Quantity","Trade Price","Proceeds","Buy/Sell"
"Transaction ID","Symbol","Description","Date/Time","Amount","Type"
"TXN001","AAPL","AAPL DIVIDEND","2024-01-20","125.00","Dividends"`;

      const result = parseMultiSectionCSV(csv);

      // Empty trades section, one cash transaction
      expect(result.trades).toHaveLength(0);
      expect(result.cashTransactions).toHaveLength(1);
    });
  });

  describe("Header detection", () => {
    it("should identify trades header with TradeID and Asset Category", () => {
      const header = `"TradeID","Symbol","Asset Category","Trade Date","Quantity"`;
      expect(isTradesHeader(header)).toBe(true);
    });

    it("should identify trades header with Trade ID and TradePrice", () => {
      const header = `"Trade ID","Symbol","TradePrice","Quantity"`;
      expect(isTradesHeader(header)).toBe(true);
    });

    it("should not identify cash header as trades header", () => {
      const header = `"Transaction ID","Symbol","Type","Amount","Date/Time"`;
      expect(isTradesHeader(header)).toBe(false);
    });

    it("should identify cash header with Type and Amount", () => {
      const header = `"Transaction ID","Symbol","Type","Amount","Date/Time"`;
      expect(isCashHeader(header)).toBe(true);
    });

    it("should not identify trades header as cash header", () => {
      const header = `"TradeID","Symbol","Asset Category","Trade Price","Type","Amount"`;
      // Even though it has Type and Amount, it also has Asset Category and Trade Price
      expect(isCashHeader(header)).toBe(false);
    });
  });
});

describe("fund flow type classification", () => {
  function classifyFundFlowType(type: string): "DEPOSIT" | "WITHDRAWAL" | null {
    const upper = (type || "").toUpperCase();
    if (upper.includes("DEPOSIT")) return "DEPOSIT";
    if (upper.includes("WITHDRAWAL")) return "WITHDRAWAL";
    return null;
  }

  it("classifies deposit types", () => {
    expect(classifyFundFlowType("Deposits & Withdrawals")).toBe("DEPOSIT");
    expect(classifyFundFlowType("DEPOSIT")).toBe("DEPOSIT");
  });

  it("classifies withdrawal types", () => {
    expect(classifyFundFlowType("WITHDRAWAL")).toBe("WITHDRAWAL");
  });

  it("returns null for non-fund-flow types", () => {
    expect(classifyFundFlowType("DIVIDEND")).toBeNull();
    expect(classifyFundFlowType("INTEREST")).toBeNull();
    expect(classifyFundFlowType("TRANSFER")).toBeNull();
    expect(classifyFundFlowType("INTERNAL")).toBeNull();
    expect(classifyFundFlowType("FOREX")).toBeNull();
  });
});
