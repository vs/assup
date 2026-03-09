import type { Collector, CollectedData } from "./types.js";

const EDGAR_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
const SEC_USER_AGENT = "AssupResearch/1.0 (research@assup.local)";

interface EdgarHit {
  _id: string;
  _source: {
    file_date: string;
    form_type: string;
    entity_name: string;
    file_num: string;
    period_of_report?: string;
  };
}

interface EdgarSearchResponse {
  hits: {
    hits: EdgarHit[];
    total: { value: number };
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const secFilingsCollector: Collector = {
  source: "sec_filings",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 1440,

  async collect(symbol: string): Promise<CollectedData> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      q: `"${symbol}"`,
      forms: "4",
      dateRange: "custom",
      startdt: formatDate(ninetyDaysAgo),
      enddt: formatDate(now),
    });

    const url = `${EDGAR_SEARCH_URL}?${params.toString()}`;

    const response = await globalThis.fetch(url, {
      headers: {
        "User-Agent": SEC_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `SEC EDGAR API returned ${response.status} for ${symbol}: ${response.statusText}`
      );
    }

    const result = (await response.json()) as EdgarSearchResponse;

    const hits = result.hits?.hits ?? [];

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentFilings = hits.map((hit) => ({
      id: hit._id,
      fileDate: hit._source.file_date,
      formType: hit._source.form_type,
      entityName: hit._source.entity_name,
      periodOfReport: hit._source.period_of_report ?? null,
    }));

    // Both counts derived from returned hits (same page) for consistency
    const filingCount90d = recentFilings.length;
    const filingCount30d = recentFilings.filter((f) => {
      const fileDate = new Date(f.fileDate);
      return fileDate >= thirtyDaysAgo;
    }).length;

    return {
      source: "sec_filings",
      data: {
        symbol,
        filingCount90d,
        filingCount30d,
        recentFilings,
        searchUrl: url,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + this.stalenessMinutes * 60 * 1000),
    };
  },
};
