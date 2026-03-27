import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["FYEstimate", "FYActual", "Recommendation"].includes(name),
});

function safeNum(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export interface ParsedReportSnapshot {
  companyName: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  earningsDates: Array<{ date: string; eps: number | null; quarter: string }>;
}

/**
 * Parse IBKR ReportSnapshot XML (Thomson Reuters company overview).
 * Contains earnings history/estimates and company info.
 */
export function parseReportSnapshot(xml: string): ParsedReportSnapshot {
  if (!xml) return { companyName: null, exchange: null, sector: null, industry: null, earningsDates: [] };

  const doc = parser.parse(xml);
  const report = doc?.ReportSnapshot ?? doc?.ReportFinancialStatements;
  if (!report) return { companyName: null, exchange: null, sector: null, industry: null, earningsDates: [] };

  const coGenInfo = report?.CoGeneralInfo ?? {};
  const companyName = coGenInfo?.CoName?.["#text"] ?? coGenInfo?.CoName ?? null;

  // Try to get sector/industry from CoIDs or classification
  const coIds = report?.CoIDs ?? {};
  const exchange = coIds?.Exchange?.["#text"] ?? coIds?.Exchange ?? null;

  // Industry classification from the Issues/Industry path
  const issues = report?.Issues ?? {};
  const sector = issues?.Sector?.["#text"] ?? issues?.Sector ?? null;
  const industry = issues?.Industry?.["#text"] ?? issues?.Industry ?? null;

  // Earnings from EPSActuals or EPSEstimates
  const earningsDates: ParsedReportSnapshot["earningsDates"] = [];

  // Walk through any available EPS actual data
  const epsSection = report?.EPSActuals ?? report?.Ratios?.Group;
  if (Array.isArray(epsSection?.FYActual)) {
    for (const fy of epsSection.FYActual) {
      const date = fy?.["@_endMonth"] ?? fy?.["@_reportDate"] ?? "";
      const eps = safeNum(fy?.["#text"] ?? fy?.EPS);
      const period = fy?.["@_fYear"] ?? "";
      if (date) earningsDates.push({ date: String(date), eps, quarter: String(period) });
    }
  }

  return { companyName, exchange, sector, industry, earningsDates };
}

export interface ParsedRESC {
  analysts: Array<{
    firm: string;
    rating: string;
    priceTarget: number | null;
    date: string;
  }>;
  consensusRating: number | null; // 1=strong buy ... 5=strong sell
  targetPrice: number | null;
  buyCount: number;
  holdCount: number;
  sellCount: number;
}

/**
 * Parse IBKR RESC XML (Thomson Reuters Estimates & Recommendations).
 */
export function parseRESC(xml: string): ParsedRESC {
  const empty: ParsedRESC = { analysts: [], consensusRating: null, targetPrice: null, buyCount: 0, holdCount: 0, sellCount: 0 };
  if (!xml) return empty;

  const doc = parser.parse(xml);
  const resc = doc?.RESC ?? doc?.ResearchEstimates;
  if (!resc) return empty;

  // Consensus data
  const consensus = resc?.Consensus ?? resc?.ConsEstimate ?? {};
  const targetPrice = safeNum(consensus?.TargetPrice ?? consensus?.["@_targetPrice"]);
  const consensusRating = safeNum(consensus?.Rating ?? consensus?.["@_rating"]);

  // Individual recommendations
  const analysts: ParsedRESC["analysts"] = [];
  const recs = resc?.Recommendations?.Recommendation ?? resc?.BrokerRatings?.Recommendation ?? [];
  const recArr = Array.isArray(recs) ? recs : [recs];
  let buyCount = 0, holdCount = 0, sellCount = 0;

  for (const rec of recArr) {
    if (!rec) continue;
    const firm = rec?.["@_broker"] ?? rec?.Broker ?? rec?.["@_firm"] ?? "Unknown";
    const rating = String(rec?.["@_rating"] ?? rec?.Rating ?? rec?.["#text"] ?? "");
    const pt = safeNum(rec?.["@_targetPrice"] ?? rec?.TargetPrice);
    const date = rec?.["@_date"] ?? rec?.Date ?? "";

    // Count buy/hold/sell (ratings are typically 1-5 scale or text)
    const ratingNum = safeNum(rating);
    if (ratingNum !== null) {
      if (ratingNum <= 2) buyCount++;
      else if (ratingNum <= 3) holdCount++;
      else sellCount++;
    } else {
      const lowerRating = rating.toLowerCase();
      if (lowerRating.includes("buy") || lowerRating.includes("overweight") || lowerRating.includes("outperform")) buyCount++;
      else if (lowerRating.includes("sell") || lowerRating.includes("underweight") || lowerRating.includes("underperform")) sellCount++;
      else holdCount++;
    }

    analysts.push({ firm: String(firm), rating, priceTarget: pt, date: String(date) });
  }

  return { analysts, consensusRating, targetPrice, buyCount, holdCount, sellCount };
}

export interface ParsedFundamentalRatios {
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  epsGrowth: number | null;
  dividendYield: number | null;
  revenue: number | null;
  marketCap: number | null;
  beta: number | null;
  roe: number | null;
  debtToEquity: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  bookValue: number | null;
  priceToBook: number | null;
  priceToCashFlow: number | null;
}

/**
 * Parse the pipe-delimited fundamental ratios string from generic tick 258.
 * Format: "key1=val1;key2=val2;..." (semicolon-delimited key=value pairs)
 */
export function parseFundamentalRatiosTick(tickString: string | undefined): ParsedFundamentalRatios {
  const result: ParsedFundamentalRatios = {
    pe: null, forwardPe: null, eps: null, epsGrowth: null, dividendYield: null,
    revenue: null, marketCap: null, beta: null, roe: null, debtToEquity: null,
    profitMargin: null, revenueGrowth: null, bookValue: null, priceToBook: null,
    priceToCashFlow: null,
  };

  if (!tickString) return result;

  const map = new Map<string, string>();
  for (const pair of tickString.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      map.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
    }
  }

  result.pe = safeNum(map.get("APENORM") ?? map.get("PE"));
  result.forwardPe = safeNum(map.get("AFEESSION") ?? map.get("FwdPE"));
  result.eps = safeNum(map.get("TTMEPSXCLX") ?? map.get("EPS"));
  result.epsGrowth = safeNum(map.get("EPSCHNGYR") ?? map.get("EGRPCT"));
  result.dividendYield = safeNum(map.get("YIELD") ?? map.get("DIVYIELD"));
  result.revenue = safeNum(map.get("TTMREV") ?? map.get("Revenue"));
  result.marketCap = safeNum(map.get("MKTCAP"));
  result.beta = safeNum(map.get("BETA"));
  result.roe = safeNum(map.get("TTMROEPCT") ?? map.get("ROE"));
  result.debtToEquity = safeNum(map.get("QTOTD2EQ") ?? map.get("DebtToEquity"));
  result.profitMargin = safeNum(map.get("TTMNPMGN") ?? map.get("NetProfitMargin"));
  result.revenueGrowth = safeNum(map.get("REVCHNGYR") ?? map.get("RevenueGrowth"));
  result.bookValue = safeNum(map.get("PRICE2BK"));
  result.priceToBook = safeNum(map.get("PRICE2BK"));
  result.priceToCashFlow = safeNum(map.get("TTMPRCFPS"));

  return result;
}

export interface ParsedDividend {
  past12Months: number | null;
  next12Months: number | null;
  nextDate: string | null;
  annualAmount: number | null;
}

/**
 * Parse the IB_DIVIDENDS tick string (tick 456 / type 7674).
 * Format: "past12,next12,nextDate,annualAmount"
 */
export function parseDividendTick(tickString: string | undefined): ParsedDividend {
  const result: ParsedDividend = { past12Months: null, next12Months: null, nextDate: null, annualAmount: null };
  if (!tickString) return result;

  const parts = tickString.split(",");
  if (parts.length >= 1) result.past12Months = safeNum(parts[0]);
  if (parts.length >= 2) result.next12Months = safeNum(parts[1]);
  if (parts.length >= 3 && parts[2]) result.nextDate = parts[2];
  if (parts.length >= 4) result.annualAmount = safeNum(parts[3]);

  return result;
}
