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
  // IBKR cost basis and realized P&L (for positions opened before import period)
  costBasis?: string;
  fifoPnlRealized?: string;
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

interface FlexCorporateAction {
  actionID: string;
  symbol: string;
  description?: string;
  conid?: string;
  type: string; // FS (forward split), RS (reverse split), SD (stock dividend), TC (ticker change)
  exDate: string;
  payDate?: string;
  quantity: string;
  value?: string;
}

interface ParsedFlexData {
  trades: FlexTrade[];
  cashTransactions: FlexCashTransaction[];
  corporateActions: FlexCorporateAction[];
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
          corporateActionsImported: 0,
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
        recordCount: parsed.trades.length + parsed.cashTransactions.length + parsed.corporateActions.length,
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

    // Import corporate actions (with deduplication)
    console.log(`[Import] Importing ${parsed.corporateActions.length} corporate actions...`);
    const caStats = await this.importCorporateActions(
      batch.id,
      parsed.corporateActions
    );
    console.log(`[Import] Corporate actions import complete: ${caStats.imported} imported, ${caStats.skipped} skipped`);

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
        corporateActionsImported: caStats.imported,
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
      costBasis: t.cost || t.costBasis,
      fifoPnlRealized: t.fifoPnlRealized || t.realizedPnl || t.mtmPnl,
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

    // Extract corporate actions
    const caSection = statement.CorporateActions || {};
    const rawCA = caSection.CorporateAction || [];
    const corporateActions: FlexCorporateAction[] = (
      Array.isArray(rawCA) ? rawCA : rawCA ? [rawCA] : []
    ).map((ca: Record<string, string>) => ({
      actionID: ca.actionID || `${ca.exDate || ca.dateTime}-${ca.symbol}-${ca.type}`,
      symbol: ca.symbol,
      description: ca.description,
      conid: ca.conid,
      type: ca.type,
      exDate: ca.exDate || ca.dateTime || ca.reportDate,
      payDate: ca.payDate,
      quantity: ca.quantity,
      value: ca.value,
    }));

    // Determine period from data
    const allDates = [
      ...trades.map((t) => this.parseDate(t.tradeDate)),
      ...cashTransactions.map((c) => this.parseDate(c.dateTime)),
      ...corporateActions.map((ca) => this.parseDate(ca.exDate)),
    ].filter((d) => d !== null) as Date[];

    const periodStart =
      allDates.length > 0
        ? new Date(Math.min(...allDates.map((d) => d.getTime())))
        : new Date();
    const periodEnd =
      allDates.length > 0
        ? new Date(Math.max(...allDates.map((d) => d.getTime())))
        : new Date();

    return { trades, cashTransactions, corporateActions, periodStart, periodEnd };
  }

  /**
   * Parse CSV format (Activity Statement export)
   */
  /**
   * Detect if a line is a trades section header
   */
  private isTradesHeader(line: string): boolean {
    const hasAssetCategory = line.includes('"Asset Category"') || line.includes('"AssetClass"');
    const hasTradePrice = line.includes('"Trade Price"') || line.includes('"TradePrice"');
    const hasTradeId = line.includes('"TradeID"') || line.includes('"Trade ID"');
    return hasTradeId && (hasAssetCategory || hasTradePrice);
  }

  /**
   * Detect if a line is a cash transactions section header
   */
  private isCashHeader(line: string): boolean {
    const hasType = line.includes('"Type"') || line.includes('"type"');
    const hasAmount = line.includes('"Amount"') || line.includes('"amount"');
    const hasAssetCategory = line.includes('"Asset Category"') || line.includes('"AssetClass"');
    const hasTradePrice = line.includes('"Trade Price"') || line.includes('"TradePrice"');
    return hasType && hasAmount && !hasAssetCategory && !hasTradePrice;
  }

  /**
   * Detect if a line is a corporate actions section header
   */
  private isCorporateActionsHeader(line: string): boolean {
    // Corporate actions have ActionID/Action ID and Type columns, plus a date field
    const hasActionId = line.includes('"ActionID"') || line.includes('"Action ID"');
    const hasDate = line.includes('"ExDate"') || line.includes('"Ex-Date"') || line.includes('"Date/Time"') || line.includes('"DateTime"');
    const hasType = line.includes('"Type"');
    return hasActionId && hasDate && hasType;
  }

  private parseCSV(content: string): ParsedFlexData {
    // IBKR FLEX reports can have multiple sections with different headers
    // We need to find ALL trades sections and ALL cash sections, not just the first of each
    const lines = content.split("\n");

    console.log(`[Import] CSV has ${lines.length} lines`);
    console.log(`[Import] First line: ${lines[0]?.substring(0, 100)}...`);

    // Identify all section boundaries
    interface Section {
      type: "trades" | "cash" | "corporateActions";
      startLine: number;
      headerLine: string;
    }

    const sections: Section[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (this.isTradesHeader(line)) {
        sections.push({ type: "trades", startLine: i, headerLine: line });
        console.log(`[Import] Found trades header at line ${i}`);
      } else if (this.isCorporateActionsHeader(line)) {
        sections.push({ type: "corporateActions", startLine: i, headerLine: line });
        console.log(`[Import] Found corporate actions header at line ${i}`);
      } else if (this.isCashHeader(line)) {
        sections.push({ type: "cash", startLine: i, headerLine: line });
        console.log(`[Import] Found cash header at line ${i}`);
      }
    }

    console.log(`[Import] Found ${sections.length} sections: ${sections.map(s => `${s.type}@${s.startLine}`).join(", ")}`);

    const trades: FlexTrade[] = [];
    const cashTransactions: FlexCashTransaction[] = [];
    const corporateActions: FlexCorporateAction[] = [];

    // Process each section
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const nextSection = sections[i + 1];
      const endLine = nextSection ? nextSection.startLine : lines.length;

      // Extract section content (header + data)
      const sectionLines = lines.slice(section.startLine, endLine);
      const sectionContent = sectionLines.join("\n");

      if (section.type === "trades") {
        const sectionTrades = this.parseTradesSection(sectionContent, trades.length);
        console.log(`[Import] Trades section ${i} (lines ${section.startLine}-${endLine}): ${sectionTrades.length} trades`);
        trades.push(...sectionTrades);
      } else if (section.type === "corporateActions") {
        const sectionCA = this.parseCorporateActionsSection(sectionContent);
        console.log(`[Import] Corporate actions section ${i} (lines ${section.startLine}-${endLine}): ${sectionCA.length} actions`);
        corporateActions.push(...sectionCA);
      } else {
        const sectionCash = this.parseCashSection(sectionContent);
        console.log(`[Import] Cash section ${i} (lines ${section.startLine}-${endLine}): ${sectionCash.length} transactions`);
        cashTransactions.push(...sectionCash);
      }
    }

    const allDates = [
      ...trades.map((t) => this.parseDate(t.tradeDate)),
      ...cashTransactions.map((c) => this.parseDate(c.dateTime)),
      ...corporateActions.map((ca) => this.parseDate(ca.exDate)),
    ].filter((d) => d !== null) as Date[];

    const periodStart =
      allDates.length > 0
        ? new Date(Math.min(...allDates.map((d) => d.getTime())))
        : new Date();
    const periodEnd =
      allDates.length > 0
        ? new Date(Math.max(...allDates.map((d) => d.getTime())))
        : new Date();

    console.log(`[Import] Parsed ${trades.length} trades, ${cashTransactions.length} cash transactions, ${corporateActions.length} corporate actions`);
    console.log(`[Import] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

    return { trades, cashTransactions, corporateActions, periodStart, periodEnd };
  }

  /**
   * Parse a single trades section from CSV content
   */
  private parseTradesSection(sectionContent: string, seqOffset: number): FlexTrade[] {
    const trades: FlexTrade[] = [];

    const tradeRecords = parseCSV(sectionContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    if (tradeRecords.length === 0) {
      return trades;
    }

    // Filter out rows that look like intermediate headers (from other sections)
    // These have non-numeric Quantity or TradePrice values
    const validRecords = tradeRecords.filter(record => {
      const quantity = record["Quantity"];
      const tradePrice = record["T. Price"] || record["Trade Price"] || record["TradePrice"];

      // Skip if quantity looks like a header value (non-numeric or missing)
      if (quantity && isNaN(parseFloat(quantity))) {
        console.log(`[Import] Skipping intermediate header row in trades: ${record["Symbol"]} - ${quantity}`);
        return false;
      }
      // Skip if trade price looks like a header value
      if (tradePrice && isNaN(parseFloat(tradePrice))) {
        console.log(`[Import] Skipping intermediate header row in trades: ${record["Symbol"]} - ${tradePrice}`);
        return false;
      }
      return true;
    });

    // If no valid data rows, return empty (section only had headers)
    if (validRecords.length === 0) {
      console.log(`[Import] Trades section has no valid data rows (only headers)`);
      return trades;
    }

    // Validate required columns exist using a record with all columns
    // Use the header's columns (from csv-parse) rather than a data row's keys
    const columns = Object.keys(tradeRecords[0]);
    // Also check that Quantity column exists and has valid data in at least one record
    const hasQuantity = columns.some(c => c === "Quantity") ||
      validRecords.some(r => r["Quantity"] !== undefined);
    const hasTradeDate = columns.some(c =>
      c === "Trade Date" || c === "TradeDate" || c === "Date/Time"
    );

    if (!hasQuantity) {
      throw new Error(
        `CSV import failed: Missing required 'Quantity' column. ` +
        `Available columns: ${columns.join(", ")}. ` +
        `Please reconfigure your FLEX Query to include the Quantity field.`
      );
    }

    if (!hasTradeDate) {
      throw new Error(
        `CSV import failed: Missing required trade date column (expected 'Trade Date', 'TradeDate', or 'Date/Time'). ` +
        `Available columns: ${columns.join(", ")}. ` +
        `Please reconfigure your FLEX Query to include the TradeDate field.`
      );
    }

    let csvTradeSeq = seqOffset;
    for (const record of validRecords) {
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
            record["Trade ID"] ||
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
          costBasis: record["Basis"] || record["Cost Basis"] || record["CostBasis"],
          fifoPnlRealized: record["Realized P/L"] || record["FIFO P/L Realized"] || record["FifoPnlRealized"] || record["MTM P/L"],
        });
      }
    }

    return trades;
  }

  /**
   * Parse a single cash transactions section from CSV content
   */
  private parseCashSection(sectionContent: string): FlexCashTransaction[] {
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
      const txCurrency = record["CurrencyPrimary"] || record["Currency"];
      const txId = record["Transaction ID"] || record["TransactionID"] || record["transactionID"];

      // Skip intermediate header rows (amount must be a valid number)
      if (txAmount && isNaN(parseFloat(txAmount))) {
        console.log(`[Import] Skipping intermediate header row: ${txType} - ${txAmount}`);
        continue;
      }

      if (txType && txAmount) {
        cashTransactions.push({
          transactionID: txId || `${txDate}-${txType}-${txAmount}`,
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

    return cashTransactions;
  }

  /**
   * Parse a single corporate actions section from CSV content
   */
  private parseCorporateActionsSection(sectionContent: string): FlexCorporateAction[] {
    const corporateActions: FlexCorporateAction[] = [];

    const records = parseCSV(sectionContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    for (const record of records) {
      const actionType = record["Type"];
      const exDate = record["ExDate"] || record["Ex-Date"] || record["Ex Date"] || record["Date/Time"] || record["DateTime"];
      const actionId = record["ActionID"] || record["Action ID"];
      const quantity = record["Quantity"];

      // Skip intermediate header rows
      if (quantity && isNaN(parseFloat(quantity))) {
        console.log(`[Import] Skipping intermediate header row in corporate actions: ${record["Symbol"]} - ${quantity}`);
        continue;
      }

      if (actionType && exDate && actionId) {
        corporateActions.push({
          actionID: actionId,
          symbol: record["Symbol"],
          description: record["Description"],
          conid: record["Conid"],
          type: actionType,
          exDate,
          payDate: record["PayDate"] || record["Pay Date"],
          quantity: quantity || "0",
          value: record["Value"] || record["Proceeds"] || "0",
        });
      }
    }

    return corporateActions;
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

      // Parse and validate trade date
      const tradeDate = this.parseDate(trade.tradeDate);
      if (!tradeDate) {
        throw new Error(
          `Import failed: Invalid trade date format '${trade.tradeDate}' for trade ${trade.tradeID} (${trade.symbol}). ` +
          `Supported formats: YYYYMMDD, YYYYMMDD;HHMMSS, YYYY-MM-DD, MM/DD/YYYY, DD-MMM-YY.`
        );
      }

      // Parse and validate quantity
      const quantity = parseFloat(trade.quantity);
      if (isNaN(quantity)) {
        throw new Error(
          `Import failed: Invalid quantity '${trade.quantity}' for trade ${trade.tradeID} (${trade.symbol}).`
        );
      }

      // Parse and validate trade price
      const tradePrice = parseFloat(trade.tradePrice);
      if (isNaN(tradePrice)) {
        throw new Error(
          `Import failed: Invalid trade price '${trade.tradePrice}' for trade ${trade.tradeID} (${trade.symbol}).`
        );
      }

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
          tradeDate,
          quantity,
          tradePrice,
          proceeds: parseFloat(trade.proceeds),
          commission: trade.ibCommission
            ? Math.abs(parseFloat(trade.ibCommission))
            : 0,
          buySell: trade.buySell.toUpperCase(),
          openClose: trade.openCloseIndicator?.toUpperCase(),
          costBasis: trade.costBasis ? parseFloat(trade.costBasis) : null,
          realizedPnl: trade.fifoPnlRealized ? parseFloat(trade.fifoPnlRealized) : null,
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

      // Parse and validate transaction date
      const transactionDate = this.parseDate(tx.dateTime);
      if (!transactionDate) {
        throw new Error(
          `Import failed: Invalid transaction date format '${tx.dateTime}' for transaction ${tx.transactionID} (${tx.type}). ` +
          `Supported formats: YYYYMMDD, YYYYMMDD;HHMMSS, YYYY-MM-DD, MM/DD/YYYY, DD-MMM-YY.`
        );
      }

      // Parse and validate amount
      const amount = parseFloat(tx.amount);
      if (isNaN(amount)) {
        throw new Error(
          `Import failed: Invalid amount '${tx.amount}' for transaction ${tx.transactionID} (${tx.type}).`
        );
      }

      await prisma.cashTransaction.create({
        data: {
          importBatchId: batchId,
          transactionId: tx.transactionID,
          symbol: tx.symbol || null,
          description: tx.description,
          conId: tx.conid ? parseInt(tx.conid, 10) : null,
          transactionDate,
          amount,
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
   * Import corporate actions with deduplication
   */
  private async importCorporateActions(
    batchId: string,
    actions: FlexCorporateAction[]
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const action of actions) {
      // Check for existing action
      const existing = await prisma.corporateAction.findUnique({
        where: { actionId: action.actionID },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Parse and validate ex-date
      const exDate = this.parseDate(action.exDate);
      if (!exDate) {
        throw new Error(
          `Import failed: Invalid ex-date format '${action.exDate}' for corporate action ${action.actionID} (${action.symbol}). ` +
          `Supported formats: YYYYMMDD, YYYYMMDD;HHMMSS, YYYY-MM-DD, MM/DD/YYYY, DD-MMM-YY.`
        );
      }

      const payDate = action.payDate ? this.parseDate(action.payDate) : null;
      const quantity = parseFloat(action.quantity || "0");
      const value = parseFloat(action.value || "0");

      // Calculate split ratio from description or quantity
      // For forward splits, description often contains "SPLIT 10 FOR 1" or similar
      // Quantity shows net shares received (e.g., +90 for 10:1 split on 10 shares)
      let splitRatio: number | null = null;
      if (action.type === "FS" || action.type === "RS" || action.type === "SD") {
        // Try to parse ratio from description
        const ratioMatch = action.description?.match(/(\d+)\s*(?:FOR|:)\s*(\d+)/i);
        if (ratioMatch) {
          const newShares = parseInt(ratioMatch[1], 10);
          const oldShares = parseInt(ratioMatch[2], 10);
          if (action.type === "RS") {
            // Reverse split: 1 for 10 means ratio = 0.1
            splitRatio = oldShares / newShares;
          } else {
            // Forward split: 10 for 1 means ratio = 10
            splitRatio = newShares / oldShares;
          }
        }
      }

      await prisma.corporateAction.create({
        data: {
          importBatchId: batchId,
          actionId: action.actionID,
          symbol: action.symbol,
          description: action.description,
          conId: action.conid ? parseInt(action.conid, 10) : null,
          actionType: action.type,
          exDate,
          payDate,
          quantity,
          value,
          splitRatio,
        },
      });

      imported++;
    }

    return { imported, skipped };
  }

  /**
   * Check if an expiry date has passed (is before today, not including today).
   * Options expiring today are still trading and shouldn't be marked as expired/assigned
   * until the next business day when settlement occurs.
   */
  private hasExpiryPassed(expiryDate: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    expiry.setHours(0, 0, 0, 0);
    return expiry < today;
  }

  /**
   * Detect option assignments by correlating option closes with stock trades.
   * An assignment is detected when:
   * 1. There's a close trade (BUY to close) at $0 or near $0, OR the option has expired
   * 2. There's a stock trade on or around the close/expiry date
   * 3. The trade price is close to the strike (within 2%)
   * 4. The trade quantity matches the option contracts (100 shares per contract)
   *
   * This handles both:
   * - Early assignments (option closed at $0 before expiry with matching stock trade)
   * - Expiration assignments (option expired and was assigned on expiry)
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
      if (!option.expiry || !option.underlying || !option.strike) continue;

      // Find the close trade for this option (if it exists)
      // Use conId if available for reliable matching, otherwise match by symbol
      const closeTrade = await prisma.importedTrade.findFirst({
        where: option.conId
          ? {
              conId: option.conId,
              secType: "OPT",
              buySell: "BUY",
              openClose: "C",
            }
          : {
              symbol: option.symbol,
              secType: "OPT",
              buySell: "BUY",
              openClose: "C",
              strike: option.strike,
              expiry: option.expiry,
              right: option.right,
            },
      });

      // Determine if this could be an assignment:
      // 1. Early assignment: close trade exists at $0 (or very low price) before expiry
      // 2. Expiration assignment: expiry has passed
      const isEarlyClose = closeTrade && closeTrade.tradePrice <= 0.01;
      const isExpired = this.hasExpiryPassed(option.expiry);

      // Skip if neither condition applies
      if (!isEarlyClose && !isExpired) continue;

      // Determine the date to search around
      // For early assignments, use the close trade date
      // For expiration assignments, use the expiry date
      let searchDate: Date;
      if (isEarlyClose && closeTrade) {
        searchDate = new Date(closeTrade.tradeDate);
      } else {
        searchDate = new Date(option.expiry);
      }

      // Search for stock trades around the search date
      // Include 1 day before (for T+1 settlement edge cases) and 5 days after
      const searchStart = new Date(searchDate);
      searchStart.setDate(searchStart.getDate() - 1);
      const searchEnd = new Date(searchDate);
      searchEnd.setDate(searchEnd.getDate() + 5);

      // Find stock trades that match assignment criteria
      const potentialAssignments = await prisma.importedTrade.findMany({
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

      if (potentialAssignments.length > 0) {
        // Expected quantity for assignment: 100 shares per option contract
        const optionContracts = Math.abs(option.quantity);
        const expectedShares = optionContracts * 100;

        // Find a matching stock trade with correct price AND quantity
        const matchingAssignment = potentialAssignments.find((trade) => {
          // Check if trade price is close to strike (within 2%)
          const priceDiff =
            Math.abs(trade.tradePrice - option.strike!) / option.strike!;
          if (priceDiff >= 0.02) return false;

          // Check if trade quantity matches expected shares (within 10% tolerance for partial fills)
          const tradeShares = Math.abs(trade.quantity);
          const quantityDiff = Math.abs(tradeShares - expectedShares) / expectedShares;
          if (quantityDiff >= 0.1) return false;

          return true;
        });

        if (matchingAssignment) {
          await prisma.importedTrade.update({
            where: { id: option.id },
            data: {
              wasAssigned: true,
              assignmentDate: matchingAssignment.tradeDate,
            },
          });
          detected++;
        }
      }
    }

    return detected;
  }

  /**
   * Recalculate assignments for all options.
   * This clears any assignment flags and re-detects based on current data.
   * Use this to fix false positives/negatives from earlier detection runs.
   */
  async recalculateAssignments(): Promise<{ cleared: number; detected: number }> {
    // Clear wasAssigned for ALL options that were marked as assigned
    // This allows re-detection with the improved algorithm (including early assignments)
    const clearResult = await prisma.importedTrade.updateMany({
      where: {
        secType: "OPT",
        wasAssigned: true,
      },
      data: {
        wasAssigned: false,
        assignmentDate: null,
      },
    });

    // Re-run detection with improved algorithm
    const detected = await this.detectAssignments();

    return {
      cleared: clearResult.count,
      detected,
    };
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

    // Trim whitespace
    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    // YYYYMMDD;HHMMSS (IBKR Date/Time format)
    if (/^\d{8};\d{6}$/.test(trimmed)) {
      const datePart = trimmed.split(";")[0];
      return new Date(
        `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
      );
    }

    // YYYYMMDD (plain 8-digit date)
    if (/^\d{8}$/.test(trimmed)) {
      return new Date(
        `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
      );
    }

    // YYYY-MM-DD (with optional time component)
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return new Date(trimmed.split(/[T;]/)[0]);
    }

    // MM/DD/YYYY (US format, must be exactly 2-digit month and day)
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [month, day, year] = trimmed.split("/");
      return new Date(`${year}-${month}-${day}`);
    }

    // DD-MMM-YY or DD-MMM-YYYY (e.g., "15-Feb-19" or "15-Feb-2019")
    const monthNames: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
    };
    const dmmyMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (dmmyMatch) {
      const [, day, monthStr, yearStr] = dmmyMatch;
      const month = monthNames[monthStr.toLowerCase()];
      const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
      if (month) {
        return new Date(`${year}-${month}-${day.padStart(2, "0")}`);
      }
    }

    // No guessing - return null for unrecognized formats
    return null;
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
