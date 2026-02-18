/**
 * Service for exporting tax data to XLSX format
 * Creates formatted spreadsheets for Czech tax reporting
 */

import ExcelJS from "exceljs";
import { taxCalculationService } from "./taxCalculation.service.js";
import { cnbExchangeRateService } from "./cnbExchangeRate.service.js";
import type {
  TaxSummary,
  TaxStockTrade,
  TaxOptionTrade,
  TaxDividend,
  TaxInterest,
  DividendsByCountry,
} from "@assup/shared";

class TaxExportService {
  /**
   * Generate XLSX export for tax reporting
   */
  async generateExport(year: number): Promise<Buffer> {
    const summary = await taxCalculationService.getSummary(year);

    if (!summary.canExport) {
      throw new Error(
        `Cannot export: ${summary.missingRecords.length} missing trade records`
      );
    }

    const stockTrades = await taxCalculationService.getStockTrades(year);
    const optionTrades = await taxCalculationService.getOptionTrades(year);
    const dividends = await taxCalculationService.getDividends(year);
    const interest = await taxCalculationService.getInterest(year);
    const rates = await cnbExchangeRateService.getRatesForYear(year);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Assup Tax Export";
    workbook.created = new Date();

    // Sheet 1: Summary
    this.addSummarySheet(workbook, summary, year);

    // Sheet 2: Stock Trades
    this.addStockTradesSheet(workbook, stockTrades.trades);

    // Sheet 3: Option Trades
    this.addOptionTradesSheet(workbook, optionTrades.trades);

    // Sheet 4: Dividends
    this.addDividendsSheet(workbook, dividends.dividends, dividends.byCountry, dividends.totals);

    // Sheet 5: Interest
    this.addInterestSheet(workbook, interest.interest, interest.total);

    // Sheet 6: Exchange Rates
    this.addExchangeRatesSheet(workbook, rates);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private addSummarySheet(
    workbook: ExcelJS.Workbook,
    summary: TaxSummary,
    year: number
  ): void {
    const sheet = workbook.addWorksheet("Summary");

    sheet.addRow([`Czech Tax Report ${year}`]);
    sheet.addRow([`Generated: ${new Date().toISOString().split("T")[0]}`]);
    sheet.addRow(["Exchange rates: CNB daily rates"]);
    sheet.addRow([]);

    sheet.addRow(["§10 D - Cenné papíry (Securities)"]);
    sheet.addRow(["Příjmy (Income):", summary.securities.income, "CZK"]);
    sheet.addRow(["Výdaje (Expenses):", summary.securities.expenses, "CZK"]);
    sheet.addRow(["Rozdíl (Difference):", summary.securities.profit, "CZK"]);
    sheet.addRow(["Trade count:", summary.securities.tradeCount]);
    sheet.addRow(["Exempt (3yr+):", summary.securities.exemptCount]);
    sheet.addRow([]);

    sheet.addRow(["§10 F - Deriváty (Derivatives)"]);
    sheet.addRow(["Příjmy (Income):", summary.derivatives.income, "CZK"]);
    sheet.addRow(["Výdaje (Expenses):", summary.derivatives.expenses, "CZK"]);
    sheet.addRow(["Rozdíl (Difference):", summary.derivatives.profit, "CZK"]);
    sheet.addRow(["Trade count:", summary.derivatives.tradeCount]);
    sheet.addRow([]);

    sheet.addRow(["§8 - Dividendy (Dividends)"]);
    sheet.addRow(["Hrubé příjmy (Gross):", summary.dividends.gross, "CZK"]);
    sheet.addRow([
      "Sražená daň (W/H Tax):",
      summary.dividends.withholdingTax,
      "CZK",
    ]);
    sheet.addRow(["Čistý příjem (Net):", summary.dividends.net, "CZK"]);
    sheet.addRow([]);

    sheet.addRow(["Foreign Tax Credit by Country:"]);
    for (const country of summary.dividends.byCountry) {
      sheet.addRow([`  ${country.country}:`, country.withholdingTax, "CZK"]);
    }
    sheet.addRow([]);

    sheet.addRow(["§8 - Úroky (Interest)"]);
    sheet.addRow(["Celkem (Total):", summary.interest.total, "CZK"]);
    sheet.addRow([]);

    sheet.addRow(["Value Test (100k CZK Threshold)"]);
    sheet.addRow(["Gross Proceeds:", summary.valueTest.grossProceedsCzk, "CZK"]);
    sheet.addRow(["Threshold:", summary.valueTest.thresholdCzk, "CZK"]);
    sheet.addRow([
      "Status:",
      summary.valueTest.isExempt ? "EXEMPT" : "NOT EXEMPT",
    ]);

    // Format numbers
    sheet.getColumn(2).numFmt = "#,##0.00";
  }

  private addStockTradesSheet(
    workbook: ExcelJS.Workbook,
    trades: TaxStockTrade[]
  ): void {
    const sheet = workbook.addWorksheet("Stock Trades");

    // Header
    sheet.addRow([
      "Date Closed",
      "Symbol",
      "Quantity",
      "Date Opened",
      "Holding Days",
      "Exempt",
      "Proceeds (USD)",
      "Cost Basis (USD)",
      "P&L (USD)",
      "Rate Close",
      "Rate Open",
      "Proceeds (CZK)",
      "Cost Basis (CZK)",
      "P&L (CZK)",
      "Status",
    ]);

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Data rows
    for (const trade of trades) {
      sheet.addRow([
        trade.dateClosed,
        trade.symbol,
        trade.quantity,
        trade.dateOpened || "",
        trade.holdingDays ?? "",
        trade.isExempt ? "Yes" : "No",
        trade.proceedsUsd,
        trade.costBasisUsd,
        trade.pnlUsd,
        trade.rateClosed,
        trade.rateOpen ?? "",
        trade.proceedsCzk,
        trade.costBasisCzk ?? "",
        trade.pnlCzk ?? "",
        trade.status === "complete" ? "✓" : "⚠️ Missing buy",
      ]);
    }

    // Auto-width columns
    sheet.columns.forEach((column) => {
      column.width = 15;
    });
  }

  private addOptionTradesSheet(
    workbook: ExcelJS.Workbook,
    trades: TaxOptionTrade[]
  ): void {
    const sheet = workbook.addWorksheet("Option Trades");

    // Header
    sheet.addRow([
      "Date Closed",
      "Symbol",
      "Description",
      "Quantity",
      "Close Type",
      "Proceeds (USD)",
      "Cost Basis (USD)",
      "P&L (USD)",
      "Rate",
      "Proceeds (CZK)",
      "Cost Basis (CZK)",
      "P&L (CZK)",
      "Status",
    ]);

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Data rows
    for (const trade of trades) {
      sheet.addRow([
        trade.dateClosed,
        trade.symbol,
        trade.description,
        trade.quantity,
        trade.closeType,
        trade.proceedsUsd,
        trade.costBasisUsd,
        trade.pnlUsd,
        trade.rate,
        trade.proceedsCzk,
        trade.costBasisCzk,
        trade.pnlCzk,
        trade.status === "complete" ? "✓" : "⚠️ Missing open",
      ]);
    }

    sheet.columns.forEach((column) => {
      column.width = 15;
    });
  }

  private addDividendsSheet(
    workbook: ExcelJS.Workbook,
    dividends: TaxDividend[],
    byCountry: DividendsByCountry[],
    totals: { gross: number; withholdingTax: number; net: number }
  ): void {
    const sheet = workbook.addWorksheet("Dividends");

    // Country summary first
    sheet.addRow(["Dividends by Country"]);
    sheet.addRow(["Country", "Gross (CZK)", "W/H Tax (CZK)", "Net (CZK)", "Count"]);

    const summaryHeaderRow = sheet.getRow(2);
    summaryHeaderRow.font = { bold: true };

    for (const country of byCountry) {
      sheet.addRow([
        country.country,
        country.gross,
        country.withholdingTax,
        country.net,
        country.count,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow([
      "Total",
      totals.gross,
      totals.withholdingTax,
      totals.net,
    ]);

    sheet.addRow([]);
    sheet.addRow([]);

    // Detail section
    sheet.addRow(["Dividend Details"]);
    sheet.addRow([
      "Date",
      "Symbol",
      "Country",
      "Gross (USD)",
      "W/H Tax (USD)",
      "Net (USD)",
      "Rate",
      "Gross (CZK)",
      "W/H Tax (CZK)",
      "Net (CZK)",
    ]);

    const detailHeaderRow = sheet.lastRow;
    if (detailHeaderRow) {
      detailHeaderRow.font = { bold: true };
      detailHeaderRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };
    }

    for (const div of dividends) {
      sheet.addRow([
        div.date,
        div.symbol,
        div.country,
        div.grossUsd,
        div.withholdingTaxUsd,
        div.netUsd,
        div.rate,
        div.grossCzk,
        div.withholdingTaxCzk,
        div.netCzk,
      ]);
    }

    sheet.columns.forEach((column) => {
      column.width = 15;
    });
  }

  private addInterestSheet(
    workbook: ExcelJS.Workbook,
    interest: TaxInterest[],
    total: number
  ): void {
    const sheet = workbook.addWorksheet("Interest");

    // Header
    sheet.addRow([
      "Date",
      "Description",
      "Amount (USD)",
      "Currency",
      "Rate",
      "Amount (CZK)",
    ]);

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Data rows
    for (const item of interest) {
      sheet.addRow([
        item.date,
        item.description,
        item.amountUsd,
        item.currency,
        item.rate,
        item.amountCzk,
      ]);
    }

    // Total row
    sheet.addRow([]);
    const totalRow = sheet.addRow(["Total", "", "", "", "", total]);
    totalRow.font = { bold: true };

    sheet.columns.forEach((column) => {
      column.width = 15;
    });
  }

  private addExchangeRatesSheet(
    workbook: ExcelJS.Workbook,
    rates: Array<{ date: string; currency: string; rate: number }>
  ): void {
    const sheet = workbook.addWorksheet("Exchange Rates");

    // Pivot rates by date
    const dateMap = new Map<string, Record<string, number>>();
    const currencies = new Set<string>();

    for (const rate of rates) {
      currencies.add(rate.currency);
      if (!dateMap.has(rate.date)) {
        dateMap.set(rate.date, {});
      }
      dateMap.get(rate.date)![rate.currency] = rate.rate;
    }

    const currencyList = Array.from(currencies).sort();

    // Header
    sheet.addRow(["Date", ...currencyList]);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Data rows
    const dates = Array.from(dateMap.keys()).sort();
    for (const date of dates) {
      const ratesByDate = dateMap.get(date)!;
      sheet.addRow([date, ...currencyList.map((c) => ratesByDate[c] || "")]);
    }

    sheet.columns.forEach((column) => {
      column.width = 12;
    });
  }
}

export const taxExportService = new TaxExportService();
