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

// ---------------------------------------------------------------------------
// Upload orchestration
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { prisma } from "../db/index.js";

export interface DividendReportUploadResultInternal {
  status: "created" | "replaced" | "duplicate";
  uploadId: string;
  replacedUploadId?: string;
  taxYear: number;
  recordCount: number;
  matchedFlexCount: number;
  recordsWithoutFlex: Array<{ symbol: string; payDate: string }>;
}

export class DividendReportImportService {
  /**
   * Upload a Dividend Report CSV. Parses, deduplicates by fileHash, replaces any
   * prior upload for the same taxYear, and returns a match summary against
   * existing FLEX CashTransaction rows.
   */
  async upload(
    fileContent: string,
    filename: string
  ): Promise<DividendReportUploadResultInternal> {
    const fileHash = createHash("sha256").update(fileContent).digest("hex");

    // Exact-hash dedup: no-op if already imported.
    const existing = await prisma.dividendReportUpload.findFirst({
      where: { fileHash },
    });
    if (existing) {
      const match = await this.computeMatchSummary(existing.id);
      return {
        status: "duplicate",
        uploadId: existing.id,
        taxYear: existing.taxYear,
        recordCount: existing.recordCount,
        matchedFlexCount: match.matchedFlexCount,
        recordsWithoutFlex: match.recordsWithoutFlex,
      };
    }

    const parsed = parseDividendReportCsv(fileContent);
    if (parsed.records.length === 0) {
      throw new Error(
        "Dividend Report parse error: file contains zero RevenueComponent rows."
      );
    }
    if (parsed.baseCurrency !== "USD") {
      console.warn(
        `[DividendReport] Non-USD base currency '${parsed.baseCurrency}' — tax calc assumes USD base.`
      );
    }

    return await prisma.$transaction(async (tx) => {
      // Replace any prior upload for the same taxYear.
      const prior = await tx.dividendReportUpload.findFirst({
        where: { taxYear: parsed.taxYear },
      });
      let replacedUploadId: string | undefined;
      if (prior) {
        replacedUploadId = prior.id;
        // Cascade deletes records.
        await tx.dividendReportUpload.delete({ where: { id: prior.id } });
      }

      const upload = await tx.dividendReportUpload.create({
        data: {
          filename,
          fileHash,
          accountNumber: parsed.accountNumber,
          taxYear: parsed.taxYear,
          recordCount: parsed.records.length,
        },
      });

      await tx.dividendReportRecord.createMany({
        data: parsed.records.map((r) => ({
          uploadId: upload.id,
          symbol: r.symbol,
          conId: r.conId,
          country: r.country,
          payDate: r.payDate,
          exDate: r.exDate,
          shares: r.shares,
          revenueComponent: r.revenueComponent,
          qualifiedIndicator: r.qualifiedIndicator,
          taxCategory: r.taxCategory,
          currency: r.currency,
          grossUsd: r.grossUsd,
          withholdUsd: r.withholdUsd,
        })),
      });

      const match = await this.computeMatchSummary(upload.id, tx);

      return {
        status: replacedUploadId ? ("replaced" as const) : ("created" as const),
        uploadId: upload.id,
        replacedUploadId,
        taxYear: upload.taxYear,
        recordCount: upload.recordCount,
        matchedFlexCount: match.matchedFlexCount,
        recordsWithoutFlex: match.recordsWithoutFlex,
      };
    });
  }

  /**
   * For a given upload, count how many DR groups (records sharing
   * (symbol, payDate)) match a FLEX CashTransaction by gross amount within
   * ±$0.01 and pay-date within ±60 days. Mirrors taxCalculation.service's
   * override logic so the UI feedback matches what tax-calc will actually do.
   */
  async computeMatchSummary(
    uploadId: string,
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
  ): Promise<{
    matchedFlexCount: number;
    recordsWithoutFlex: Array<{ symbol: string; payDate: string }>;
  }> {
    const db = tx ?? prisma;
    const records = await db.dividendReportRecord.findMany({
      where: { uploadId },
      select: { symbol: true, payDate: true, grossUsd: true },
    });
    // Build DR groups: one entry per (symbol, exact payDate), gross summed
    // across component rows.
    const groups = new Map<
      string,
      { symbol: string; payDate: string; payDateMs: number; totalGross: number }
    >();
    for (const r of records) {
      const payDate = r.payDate.toISOString().slice(0, 10);
      const key = `${r.symbol}:${payDate}`;
      const g = groups.get(key);
      if (g) g.totalGross += r.grossUsd;
      else
        groups.set(key, {
          symbol: r.symbol,
          payDate,
          payDateMs: r.payDate.getTime(),
          totalGross: r.grossUsd,
        });
    }
    // Pull all FLEX DIVIDEND rows for the symbols touched by this upload.
    const symbols = [...new Set([...groups.values()].map((g) => g.symbol))];
    const flexRows = await db.cashTransaction.findMany({
      where: { symbol: { in: symbols }, type: "DIVIDEND" },
      select: { symbol: true, transactionDate: true, amount: true, id: true },
    });
    const flexBySymbol = new Map<string, typeof flexRows>();
    for (const f of flexRows) {
      const sym = f.symbol || "";
      if (!flexBySymbol.has(sym)) flexBySymbol.set(sym, []);
      flexBySymbol.get(sym)!.push(f);
    }
    const DATE_WINDOW_DAYS = 60;
    const MS_PER_DAY = 86_400_000;
    const claimed = new Set<string>();
    let matched = 0;
    const unmatched: Array<{ symbol: string; payDate: string }> = [];
    const ordered = [...groups.values()].sort((a, b) => a.payDateMs - b.payDateMs);
    for (const group of ordered) {
      const candidates = (flexBySymbol.get(group.symbol) || []).filter((f) => {
        if (claimed.has(f.id)) return false;
        if (Math.abs(f.amount - group.totalGross) > 0.01) return false;
        const days = Math.abs(f.transactionDate.getTime() - group.payDateMs) / MS_PER_DAY;
        return days <= DATE_WINDOW_DAYS;
      });
      if (candidates.length === 0) {
        unmatched.push({ symbol: group.symbol, payDate: group.payDate });
        continue;
      }
      candidates.sort(
        (a, b) =>
          Math.abs(a.transactionDate.getTime() - group.payDateMs) -
          Math.abs(b.transactionDate.getTime() - group.payDateMs)
      );
      claimed.add(candidates[0].id);
      matched++;
    }
    return { matchedFlexCount: matched, recordsWithoutFlex: unmatched };
  }

  async listUploads() {
    return prisma.dividendReportUpload.findMany({
      orderBy: { uploadedAt: "desc" },
    });
  }

  async getUpload(id: string) {
    return prisma.dividendReportUpload.findUnique({
      where: { id },
      include: {
        records: {
          orderBy: [{ payDate: "asc" }, { symbol: "asc" }],
        },
      },
    });
  }

  async deleteUpload(id: string): Promise<void> {
    await prisma.dividendReportUpload.delete({ where: { id } });
  }
}

export const dividendReportImportService = new DividendReportImportService();
