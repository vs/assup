/**
 * Dividend Report CSV parser and import service.
 *
 * Parses IBKR-style multi-section CSVs (Account, DividendDetail,
 * DividendRevenueSummary, DividendSummaryByCountry) and emits one record
 * per RevenueComponent. Used as an authoritative override for FLEX-derived
 * dividend classification at tax-calc time.
 */

import { parse as parseCSV } from "csv-parse/sync";

export type TaxCategory =
  | "DIVIDEND"
  | "INTEREST"
  | "CAPITAL_GAIN"
  | "ROC"
  | "PIL";

export interface ParsedDividendReportRecord {
  symbol: string;
  conId: number | null;
  country: string | null;
  payDate: Date;
  exDate: Date | null;
  shares: number | null;
  revenueComponent: string;
  qualifiedIndicator: string | null;
  taxCategory: TaxCategory;
  currency: string;
  grossUsd: number;
  withholdUsd: number;
}

export interface ParsedDividendReport {
  accountNumber: string | null;
  baseCurrency: string;
  taxYear: number;
  records: ParsedDividendReportRecord[];
}

const CATEGORY_RULES: Array<{ match: RegExp; category: TaxCategory }> = [
  { match: /Interest from RIC|Interest from REIT|Bond Interest/i, category: "INTEREST" },
  { match: /Long-Term Capital Gain|Short-Term Capital Gain/i, category: "CAPITAL_GAIN" },
  { match: /Return of Capital|Non-Dividend Distribution/i, category: "ROC" },
  { match: /Payment in Lieu/i, category: "PIL" },
  // Dividend rules come last so "Ordinary Dividend"-style strings only match
  // when no more specific rule did.
  { match: /Ordinary Dividend|Ordinary Div|Qualified Dividend|Section 199A/i, category: "DIVIDEND" },
];

export function mapRevenueComponentToTaxCategory(revenueComponent: string): TaxCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(revenueComponent)) {
      return rule.category;
    }
  }
  throw new Error(
    `Unrecognised Dividend Report RevenueComponent: "${revenueComponent}". ` +
      `Add a mapping rule in dividendReportImport.service.ts CATEGORY_RULES.`
  );
}

function parseYyyymmdd(value: string | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
}

function parseNumberOrThrow(value: string, field: string, row: number): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) {
    throw new Error(
      `Dividend Report parse error: ${field} at data row ${row} is not a number: "${value}".`
    );
  }
  return n;
}

function getSectionRows(content: string, sectionName: string): string[][] {
  const lines = content.split(/\r?\n/).filter((l) => l.startsWith(`${sectionName},`));
  if (lines.length === 0) return [];
  // Parse one line at a time so a stray comma in one row can't corrupt the rest.
  const out: string[][] = [];
  for (const line of lines) {
    const parsed = parseCSV(line, { skip_empty_lines: true }) as string[][];
    if (parsed.length > 0) out.push(parsed[0]);
  }
  return out;
}

export function parseDividendReportCsv(content: string): ParsedDividendReport {
  // Account section.
  const accountRows = getSectionRows(content, "Account");
  let accountNumber: string | null = null;
  let baseCurrency = "USD";
  for (const row of accountRows) {
    if (row[1] === "Data") {
      accountNumber = row[2] || null;
      baseCurrency = row[5] || "USD";
    }
  }

  // DividendDetail section.
  const detailRows = getSectionRows(content, "DividendDetail");
  if (detailRows.length === 0) {
    throw new Error(
      "Dividend Report parse error: no DividendDetail section found."
    );
  }

  // First row in the section must be the Header.
  const header = detailRows.find((r) => r[1] === "Header");
  if (!header) {
    throw new Error(
      "Dividend Report parse error: DividendDetail section is missing the Header row."
    );
  }
  // Build a column-name → index map from the header row (offset by 2 because
  // columns 0 and 1 are the section name and discriminator).
  const colIndex = new Map<string, number>();
  for (let i = 2; i < header.length; i++) {
    if (header[i]) colIndex.set(header[i], i);
  }
  const required = [
    "DataDiscriminator",
    "Currency",
    "Symbol",
    "Conid",
    "Country",
    "ReportDate",
    "ExDate",
    "Shares",
    "RevenueComponent",
    "QualifiedIndicator",
    "Gross",
    "GrossInUSD",
    "Withhold",
    "WithholdInUSD",
  ];
  for (const name of required) {
    if (!colIndex.has(name)) {
      throw new Error(
        `Dividend Report parse error: missing required column "${name}" in DividendDetail header. ` +
          `Found columns: ${[...colIndex.keys()].join(", ")}.`
      );
    }
  }

  const records: ParsedDividendReportRecord[] = [];
  detailRows.forEach((row, i) => {
    if (row[1] !== "Data") return;
    // DataDiscriminator is the value at index 2 (first column after "Data").
    // But the Header row defines it as column "DataDiscriminator" — both align.
    const discriminator = row[colIndex.get("DataDiscriminator")!];
    if (discriminator !== "RevenueComponent") return;

    const symbol = row[colIndex.get("Symbol")!];
    const revenueComponent = row[colIndex.get("RevenueComponent")!];
    if (!symbol) {
      throw new Error(
        `Dividend Report parse error at data row ${i}: missing Symbol.`
      );
    }
    if (!revenueComponent) {
      throw new Error(
        `Dividend Report parse error at data row ${i} (${symbol}): missing RevenueComponent.`
      );
    }

    const conIdRaw = row[colIndex.get("Conid")!];
    const sharesRaw = row[colIndex.get("Shares")!];

    records.push({
      symbol,
      conId: conIdRaw ? parseInt(conIdRaw, 10) : null,
      country: row[colIndex.get("Country")!] || null,
      payDate: parseYyyymmdd(row[colIndex.get("ReportDate")!])!,
      exDate: parseYyyymmdd(row[colIndex.get("ExDate")!]),
      shares: sharesRaw ? parseFloat(sharesRaw) : null,
      revenueComponent,
      qualifiedIndicator: row[colIndex.get("QualifiedIndicator")!] || null,
      taxCategory: mapRevenueComponentToTaxCategory(revenueComponent),
      currency: row[colIndex.get("Currency")!] || "USD",
      grossUsd: parseNumberOrThrow(
        row[colIndex.get("GrossInUSD")!],
        "GrossInUSD",
        i
      ),
      withholdUsd: parseNumberOrThrow(
        row[colIndex.get("WithholdInUSD")!],
        "WithholdInUSD",
        i
      ),
    });
  });

  // Reconcile each (symbol, payDate) group's components against its Summary row.
  const summaryByKey = new Map<
    string,
    { grossUsd: number; withholdUsd: number; symbol: string; date: string }
  >();
  for (const row of detailRows) {
    if (row[1] !== "Data") continue;
    if (row[colIndex.get("DataDiscriminator")!] !== "Summary") continue;
    const symbol = row[colIndex.get("Symbol")!];
    const dateStr = row[colIndex.get("ReportDate")!];
    const grossUsd = parseFloat(row[colIndex.get("GrossInUSD")!]);
    const withholdUsd = parseFloat(row[colIndex.get("WithholdInUSD")!]);
    if (!symbol || !dateStr) continue;
    summaryByKey.set(`${symbol}:${dateStr}`, {
      grossUsd,
      withholdUsd,
      symbol,
      date: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
    });
  }
  const componentSums = new Map<string, { grossUsd: number; withholdUsd: number }>();
  for (const r of records) {
    const dateStr = `${r.payDate.getUTCFullYear()}${String(
      r.payDate.getUTCMonth() + 1
    ).padStart(2, "0")}${String(r.payDate.getUTCDate()).padStart(2, "0")}`;
    const key = `${r.symbol}:${dateStr}`;
    const cur = componentSums.get(key) ?? { grossUsd: 0, withholdUsd: 0 };
    cur.grossUsd += r.grossUsd;
    cur.withholdUsd += r.withholdUsd;
    componentSums.set(key, cur);
  }
  for (const [key, summary] of summaryByKey) {
    const sum = componentSums.get(key);
    if (!sum) {
      throw new Error(
        `Dividend Report parse error: Summary row for ${summary.symbol} ${summary.date} ` +
          `has no matching RevenueComponent rows.`
      );
    }
    const grossDelta = Math.abs(sum.grossUsd - summary.grossUsd);
    const whtDelta = Math.abs(sum.withholdUsd - summary.withholdUsd);
    if (grossDelta > 0.01) {
      throw new Error(
        `Dividend Report parse error: ${summary.symbol} ${summary.date} component Gross sum ` +
          `${sum.grossUsd.toFixed(4)} differs from Summary Gross ${summary.grossUsd.toFixed(4)} ` +
          `by delta ${grossDelta.toFixed(4)} (tolerance $0.01).`
      );
    }
    if (whtDelta > 0.01) {
      throw new Error(
        `Dividend Report parse error: ${summary.symbol} ${summary.date} component Withhold sum ` +
          `${sum.withholdUsd.toFixed(4)} differs from Summary Withhold ${summary.withholdUsd.toFixed(4)} ` +
          `by delta ${whtDelta.toFixed(4)} (tolerance $0.01).`
      );
    }
  }

  // Modal year of payDate.
  const yearCounts = new Map<number, number>();
  for (const r of records) {
    const y = r.payDate.getUTCFullYear();
    yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
  }
  let taxYear = 0;
  let maxCount = 0;
  for (const [y, c] of yearCounts) {
    if (c > maxCount) {
      taxYear = y;
      maxCount = c;
    }
  }

  return { accountNumber, baseCurrency, taxYear, records };
}
