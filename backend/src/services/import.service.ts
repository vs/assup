/**
 * Service for importing IBKR Flex Query data
 */

import { XMLParser } from "fast-xml-parser";
import { parse as parseCSV } from "csv-parse/sync";
import { createHash } from "crypto";
import { prisma } from "../db/index.js";
import type { ImportResult } from "@assup/shared";

interface FlexTrade {
  tradeID: string;
  symbol: string;
  description?: string;
  conid?: string;
  assetCategory: string;
  strike?: string;
  expiry?: string;
  putCall?: string;
  underlyingSymbol?: string;
  multiplier?: string;
  tradeDate: string;
  quantity: string;
  tradePrice: string;
  proceeds: string;
  ibCommission?: string;
  buySell: string;
  openCloseIndicator?: string;
}

interface FlexCashTransaction {
  transactionID: string;
  symbol?: string;
  description: string;
  conid?: string;
  dateTime: string;
  amount: string;
  currency?: string;
  type: string;
}

interface ParsedFlexData {
  trades: FlexTrade[];
  cashTransactions: FlexCashTransaction[];
  periodStart: Date;
  periodEnd: Date;
}

class ImportService {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseAttributeValue: false,
    });
  }

  /**
   * Import a Flex Query file (XML or CSV)
   */
  async importFlexQuery(
    fileContent: string,
    filename: string
  ): Promise<ImportResult> {
    console.log(`[Import] Starting import for file: ${filename} (${fileContent.length} bytes)`);

    // Calculate file hash for deduplication
    const fileHash = createHash("sha256").update(fileContent).digest("hex");

    // Check if this exact file was already imported
    const existingBatch = await prisma.importBatch.findFirst({
      where: { fileHash },
    });
    if (existingBatch) {
      return {
        batchId: existingBatch.id,
        filename: existingBatch.filename,
        periodStart: existingBatch.periodStart.toISOString().split("T")[0],
        periodEnd: existingBatch.periodEnd.toISOString().split("T")[0],
        stats: {
          tradesImported: 0,
          tradesSkipped: existingBatch.recordCount,
          dividendsImported: 0,
          interestImported: 0,
          otherCashImported: 0,
          assignmentsDetected: 0,
        },
      };
    }

    // Parse the file
    const isXML =
      fileContent.trim().startsWith("<?xml") ||
      fileContent.trim().startsWith("<FlexQueryResponse");
    const parsed = isXML
      ? this.parseXML(fileContent)
      : this.parseCSV(fileContent);

    // Create import batch
    const batch = await prisma.importBatch.create({
      data: {
        filename,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        recordCount: parsed.trades.length + parsed.cashTransactions.length,
        fileHash,
      },
    });

    // Import trades (with deduplication)
    console.log(`[Import] Importing ${parsed.trades.length} trades...`);
    const tradeStats = await this.importTrades(batch.id, parsed.trades);
    console.log(`[Import] Trade import complete: ${tradeStats.imported} imported, ${tradeStats.skipped} skipped`);

    // Import cash transactions (with deduplication)
    console.log(`[Import] Importing ${parsed.cashTransactions.length} cash transactions...`);
    const cashStats = await this.importCashTransactions(
      batch.id,
      parsed.cashTransactions
    );
    console.log(`[Import] Cash import complete: ${cashStats.dividends} dividends, ${cashStats.interest} interest`);

    // Detect assignments
    console.log(`[Import] Detecting assignments...`);
    const assignmentsDetected = await this.detectAssignments();
    console.log(`[Import] Assignment detection complete: ${assignmentsDetected} detected`);

    return {
      batchId: batch.id,
      filename,
      periodStart: parsed.periodStart.toISOString().split("T")[0],
      periodEnd: parsed.periodEnd.toISOString().split("T")[0],
      stats: {
        tradesImported: tradeStats.imported,
        tradesSkipped: tradeStats.skipped,
        dividendsImported: cashStats.dividends,
        interestImported: cashStats.interest,
        otherCashImported: cashStats.other,
        assignmentsDetected,
      },
    };
  }

  /**
   * Parse IBKR Flex Query XML format
   */
  private parseXML(content: string): ParsedFlexData {
    const result = this.xmlParser.parse(content);

    // Navigate through possible XML structures
    const flexResponse =
      result.FlexQueryResponse || result.FlexStatementResponse || result;
    const flexStatements =
      flexResponse.FlexStatements || flexResponse.FlexStatement || flexResponse;
    const statement = Array.isArray(flexStatements.FlexStatement)
      ? flexStatements.FlexStatement[0]
      : flexStatements.FlexStatement || flexStatements;

    // Extract trades
    const tradesSection = statement.Trades || {};
    const rawTrades = tradesSection.Trade || [];
    let tradeSeq = 0;
    const trades: FlexTrade[] = (
      Array.isArray(rawTrades) ? rawTrades : rawTrades ? [rawTrades] : []
    ).map((t: Record<string, string>) => ({
      tradeID: t.tradeID || t.transactionID || `${t.tradeDate}-${t.symbol}-${t.quantity}-${t.tradePrice}-${++tradeSeq}`,
      symbol: t.symbol,
      description: t.description,
      conid: t.conid,
      assetCategory: t.assetCategory || "STK",
      strike: t.strike,
      expiry: t.expiry,
      putCall: t.putCall,
      underlyingSymbol: t.underlyingSymbol,
      multiplier: t.multiplier,
      tradeDate: t.tradeDate || t.dateTime?.split(";")[0],
      quantity: t.quantity,
      tradePrice: t.tradePrice,
      proceeds: t.proceeds,
      ibCommission: t.ibCommission || t.commission,
      buySell: t.buySell,
      openCloseIndicator: t.openCloseIndicator,
    }));

    // Extract cash transactions
    const cashSection = statement.CashTransactions || {};
    const rawCash = cashSection.CashTransaction || [];
    const cashTransactions: FlexCashTransaction[] = (
      Array.isArray(rawCash) ? rawCash : rawCash ? [rawCash] : []
    ).map((c: Record<string, string>) => ({
      transactionID: c.transactionID || `${c.dateTime}-${c.type}-${c.amount}`,
      symbol: c.symbol,
      description: c.description || "",
      conid: c.conid,
      dateTime: c.dateTime || c.reportDate,
      amount: c.amount,
      currency: c.currency,
      type: c.type,
    }));

    // Determine period from data
    const allDates = [
      ...trades.map((t) => this.parseDate(t.tradeDate)),
      ...cashTransactions.map((c) => this.parseDate(c.dateTime)),
    ].filter((d) => d !== null) as Date[];

    const periodStart =
      allDates.length > 0
        ? new Date(Math.min(...allDates.map((d) => d.getTime())))
        : new Date();
    const periodEnd =
      allDates.length > 0
        ? new Date(Math.max(...allDates.map((d) => d.getTime())))
        : new Date();

    return { trades, cashTransactions, periodStart, periodEnd };
  }

  /**
   * Parse CSV format (Activity Statement export)
   */
  private parseCSV(content: string): ParsedFlexData {
    // IBKR FLEX reports can have multiple sections with different headers
    // Split by the cash transactions header and parse each section separately
    const sections = content.split(/\n(?="CurrencyPrimary")/);

    const trades: FlexTrade[] = [];
    const cashTransactions: FlexCashTransaction[] = [];

    // Parse trades section (first section)
    if (sections[0]) {
      const tradeRecords = parseCSV(sections[0], {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as Record<string, string>[];

      console.log(`[Import] Trades section: ${tradeRecords.length} records`);
      if (tradeRecords.length > 0) {
        console.log(`[Import] Trade columns:`, Object.keys(tradeRecords[0]));
      }

      let csvTradeSeq = 0;
      for (const record of tradeRecords) {
        const assetCategory = record["Asset Category"] || record["AssetClass"];
        const buySell = record["Buy/Sell"] || record["Code"];
        const tradeDate = record["Trade Date"] || record["TradeDate"] || record["Date/Time"];
        const quantity = record["Quantity"];
        const tradePrice = record["T. Price"] || record["Trade Price"] || record["TradePrice"];
        const inferredBuySell = buySell || (quantity && parseFloat(quantity) > 0 ? "BUY" : "SELL");

        if (assetCategory && (buySell || quantity)) {
          trades.push({
            tradeID:
              record["TradeID"] ||
              record["Transaction ID"] ||
              `${tradeDate}-${record["Symbol"]}-${quantity}-${tradePrice}-${++csvTradeSeq}`,
            symbol: record["Symbol"],
            description: record["Description"],
            conid: record["Conid"],
            assetCategory,
            strike: record["Strike"],
            expiry: record["Expiry"],
            putCall: record["Put/Call"],
            underlyingSymbol: record["Underlying Symbol"] || record["UnderlyingSymbol"],
            multiplier: record["Multiplier"],
            tradeDate,
            quantity,
            tradePrice: record["T. Price"] || record["Trade Price"] || record["TradePrice"],
            proceeds: record["Proceeds"],
            ibCommission: record["Comm/Fee"] || record["Commission"] || record["IBCommission"],
            buySell: inferredBuySell,
            openCloseIndicator: record["Open/Close"] || record["Open/CloseIndicator"],
          });
        }
      }
    }

    // Parse cash transactions section (second section, if present)
    if (sections[1]) {
      const cashSection = '"CurrencyPrimary"' + sections[1];
      const cashRecords = parseCSV(cashSection, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as Record<string, string>[];

      console.log(`[Import] Cash section: ${cashRecords.length} records`);
      if (cashRecords.length > 0) {
        console.log(`[Import] Cash columns:`, Object.keys(cashRecords[0]));
        console.log(`[Import] First cash record:`, cashRecords[0]);
      }

      for (const record of cashRecords) {
        const txType = record["Type"];
        const txAmount = record["Amount"];
        const txDate = record["Date/Time"] || record["Date"];
        const txCurrency = record["CurrencyPrimary"] || record["Currency"];

        if (txType && txAmount) {
          console.log(`[Import] Found cash transaction: ${txType} - ${txAmount} on ${txDate}`);
          cashTransactions.push({
            transactionID: `${txDate}-${txType}-${txAmount}`,
            symbol: record["Symbol"],
            description: record["Description"] || "",
            conid: record["Conid"],
            dateTime: txDate,
            amount: txAmount,
            currency: txCurrency,
            type: txType,
          });
        }
      }
    }

    const allDates = [
      ...trades.map((t) => this.parseDate(t.tradeDate)),
      ...cashTransactions.map((c) => this.parseDate(c.dateTime)),
    ].filter((d) => d !== null) as Date[];

    const periodStart =
      allDates.length > 0
        ? new Date(Math.min(...allDates.map((d) => d.getTime())))
        : new Date();
    const periodEnd =
      allDates.length > 0
        ? new Date(Math.max(...allDates.map((d) => d.getTime())))
        : new Date();

    console.log(`[Import] Parsed ${trades.length} trades, ${cashTransactions.length} cash transactions`);
    console.log(`[Import] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

    return { trades, cashTransactions, periodStart, periodEnd };
  }

  /**
   * Import trades with deduplication
   */
  private async importTrades(
    batchId: string,
    trades: FlexTrade[]
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const trade of trades) {
      // Check for existing trade
      const existing = await prisma.importedTrade.findUnique({
        where: { tradeId: trade.tradeID },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Map asset category to secType
      const secType = this.mapAssetCategory(trade.assetCategory);

      // Parse expiry date
      const expiry = trade.expiry ? this.parseDate(trade.expiry) : null;

      await prisma.importedTrade.create({
        data: {
          importBatchId: batchId,
          tradeId: trade.tradeID,
          symbol: trade.symbol,
          description: trade.description,
          conId: trade.conid ? parseInt(trade.conid, 10) : null,
          secType,
          strike: trade.strike ? parseFloat(trade.strike) : null,
          expiry,
          right: trade.putCall?.charAt(0).toUpperCase() as "C" | "P" | undefined,
          underlying: trade.underlyingSymbol || (secType === "OPT" ? trade.symbol.split(" ")[0] : null),
          multiplier: trade.multiplier ? parseInt(trade.multiplier, 10) : 100,
          tradeDate: this.parseDate(trade.tradeDate) || new Date(),
          quantity: parseFloat(trade.quantity),
          tradePrice: parseFloat(trade.tradePrice),
          proceeds: parseFloat(trade.proceeds),
          commission: trade.ibCommission
            ? Math.abs(parseFloat(trade.ibCommission))
            : 0,
          buySell: trade.buySell.toUpperCase(),
          openClose: trade.openCloseIndicator?.toUpperCase(),
        },
      });

      imported++;
    }

    return { imported, skipped };
  }

  /**
   * Import cash transactions with deduplication
   */
  private async importCashTransactions(
    batchId: string,
    transactions: FlexCashTransaction[]
  ): Promise<{ dividends: number; interest: number; other: number }> {
    let dividends = 0;
    let interest = 0;
    let other = 0;

    for (const tx of transactions) {
      // Check for existing transaction
      const existing = await prisma.cashTransaction.findUnique({
        where: { transactionId: tx.transactionID },
      });

      if (existing) {
        continue;
      }

      // Map transaction type
      const type = this.mapCashTransactionType(tx.type);

      // Skip types we don't care about
      if (type === "SKIP") {
        continue;
      }

      await prisma.cashTransaction.create({
        data: {
          importBatchId: batchId,
          transactionId: tx.transactionID,
          symbol: tx.symbol || null,
          description: tx.description,
          conId: tx.conid ? parseInt(tx.conid, 10) : null,
          transactionDate: this.parseDate(tx.dateTime) || new Date(),
          amount: parseFloat(tx.amount),
          currency: tx.currency || "USD",
          type,
        },
      });

      if (type === "DIVIDEND") dividends++;
      else if (type === "INTEREST") interest++;
      else other++;
    }

    return { dividends, interest, other };
  }

  /**
   * Detect option assignments by correlating option expirations with stock trades
   */
  async detectAssignments(): Promise<number> {
    let detected = 0;

    // Find all sold options that haven't been checked for assignment
    const shortOptions = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
        buySell: "SELL",
        openClose: "O",
        wasAssigned: false,
        expiry: { not: null },
      },
    });

    for (const option of shortOptions) {
      if (!option.expiry || !option.underlying) continue;

      // Look for stock trades on the underlying near/after expiry
      // that match the option's strike price
      const expiryDate = new Date(option.expiry);
      const searchStart = new Date(expiryDate);
      searchStart.setDate(searchStart.getDate() - 1);
      const searchEnd = new Date(expiryDate);
      searchEnd.setDate(searchEnd.getDate() + 5);

      const potentialAssignment = await prisma.importedTrade.findFirst({
        where: {
          symbol: option.underlying,
          secType: "STK",
          tradeDate: {
            gte: searchStart,
            lte: searchEnd,
          },
          // PUT assignment = buy stock at strike, CALL assignment = sell stock at strike
          buySell: option.right === "P" ? "BUY" : "SELL",
        },
      });

      if (potentialAssignment && option.strike) {
        // Check if trade price is close to strike (within 2%)
        const priceDiff =
          Math.abs(potentialAssignment.tradePrice - option.strike) /
          option.strike;
        if (priceDiff < 0.02) {
          await prisma.importedTrade.update({
            where: { id: option.id },
            data: {
              wasAssigned: true,
              assignmentDate: option.expiry,
            },
          });
          detected++;
        }
      }
    }

    return detected;
  }

  /**
   * Get all import batches
   */
  async getImportBatches() {
    return prisma.importBatch.findMany({
      orderBy: { importedAt: "desc" },
    });
  }

  /**
   * Delete an import batch and all related records
   */
  async deleteImportBatch(batchId: string): Promise<void> {
    await prisma.importBatch.delete({
      where: { id: batchId },
    });
  }

  // Helper methods

  private parseDate(dateStr: string | undefined): Date | null {
    if (!dateStr) return null;

    // Try various date formats
    // YYYYMMDD;HHMMSS (IBKR Date/Time format)
    if (/^\d{8};\d{6}$/.test(dateStr)) {
      const datePart = dateStr.split(";")[0];
      return new Date(
        `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
      );
    }

    // YYYYMMDD
    if (/^\d{8}$/.test(dateStr)) {
      return new Date(
        `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
      );
    }

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      return new Date(dateStr.split(/[T;]/)[0]);
    }

    // MM/DD/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
      const [month, day, year] = dateStr.split("/");
      return new Date(`${year}-${month}-${day}`);
    }

    // Try native parsing
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private mapAssetCategory(category: string): string {
    const upper = (category || "").toUpperCase();
    if (upper.includes("OPT") || upper === "FOP") return "OPT";
    if (upper.includes("FUT")) return "FUT";
    if (upper.includes("CASH") || upper.includes("FOREX")) return "CASH";
    return "STK";
  }

  private mapCashTransactionType(type: string): string {
    const upper = (type || "").toUpperCase();

    if (
      upper.includes("DIVIDEND") ||
      upper.includes("PAYMENT IN LIEU")
    ) {
      return "DIVIDEND";
    }

    if (
      upper.includes("INTEREST") ||
      upper.includes("BROKER INTEREST")
    ) {
      return "INTEREST";
    }

    if (upper.includes("WITHHOLDING") || upper.includes("TAX")) {
      return "WITHHOLDING_TAX";
    }

    if (
      upper.includes("COMMISSION") ||
      upper.includes("FEE") ||
      upper.includes("OTHER FEE")
    ) {
      return "FEE";
    }

    // Skip deposits, withdrawals, internal transfers, currency conversions
    if (
      upper.includes("DEPOSIT") ||
      upper.includes("WITHDRAWAL") ||
      upper.includes("TRANSFER") ||
      upper.includes("INTERNAL") ||
      upper.includes("FOREX") ||
      upper.includes("CONVERSION") ||
      upper.includes("FX")
    ) {
      return "SKIP";
    }

    return "OTHER";
  }
}

export const importService = new ImportService();
