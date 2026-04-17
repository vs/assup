import type { CollectionDataEntry } from "@assup/shared";

// --- Helpers ---

function KeyValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "--";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${fmt(n * 100, 1)}%`;
}

// --- Source Renderers ---

function TechnicalRenderer({ data }: { data: Record<string, unknown> }) {
  const meta = data as Record<string, unknown>;
  return (
    <div className="space-y-1">
      <KeyValue label="Bars" value={String((meta.ohlcv as unknown[])?.length ?? meta.bars ?? "--")} />
      <KeyValue label="Period" value={meta.period as string | undefined} />
      <p className="text-muted-foreground italic">OHLCV data rendered in chart above.</p>
    </div>
  );
}

function OptionsRenderer({ data }: { data: Record<string, unknown> }) {
  const contracts = data.contracts as Array<Record<string, unknown>> | undefined;
  if (!contracts || contracts.length === 0) {
    return <p className="text-muted-foreground">No options data available.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border/50">
            <th className="pb-1 pr-2 font-medium">Type</th>
            <th className="pb-1 pr-2 font-medium">Strike</th>
            <th className="pb-1 pr-2 font-medium">Exp</th>
            <th className="pb-1 pr-2 font-medium">IV</th>
            <th className="pb-1 pr-2 font-medium">Volume</th>
            <th className="pb-1 pr-2 font-medium">OI</th>
          </tr>
        </thead>
        <tbody>
          {contracts.slice(0, 20).map((c, i) => (
            <tr key={i} className="border-b border-border/20">
              <td className="py-0.5 pr-2">{String(c.type ?? c.contract_type ?? "--")}</td>
              <td className="py-0.5 pr-2">{fmt(c.strike as number | undefined)}</td>
              <td className="py-0.5 pr-2">{String(c.expiration ?? c.expiration_date ?? "--")}</td>
              <td className="py-0.5 pr-2">{pct(c.implied_volatility as number | undefined)}</td>
              <td className="py-0.5 pr-2">{String(c.volume ?? "--")}</td>
              <td className="py-0.5 pr-2">{String(c.open_interest ?? "--")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {contracts.length > 20 && (
        <p className="text-muted-foreground mt-1">
          Showing 20 of {contracts.length} contracts.
        </p>
      )}
    </div>
  );
}

function SocialRenderer({ data }: { data: Record<string, unknown> }) {
  const posts = data.posts as Array<Record<string, unknown>> | undefined;
  if (!posts || posts.length === 0) {
    return <p className="text-muted-foreground">No social posts found.</p>;
  }
  return (
    <div className="space-y-2">
      {posts.slice(0, 10).map((p, i) => (
        <div key={i} className="bg-muted/30 rounded px-2 py-1">
          <div className="flex items-center gap-2 text-muted-foreground mb-0.5">
            <span className="font-medium">{String(p.source ?? p.subreddit ?? "unknown")}</span>
            {p.sentiment != null && (
              <span className={
                p.sentiment === "bullish" ? "text-green-600" :
                p.sentiment === "bearish" ? "text-red-600" : "text-amber-600"
              }>
                {String(p.sentiment)}
              </span>
            )}
            {p.score != null && <span>score: {String(p.score)}</span>}
          </div>
          <p className="line-clamp-2">{String(p.title ?? p.text ?? p.body ?? "")}</p>
        </div>
      ))}
      {posts.length > 10 && (
        <p className="text-muted-foreground">
          Showing 10 of {posts.length} posts.
        </p>
      )}
    </div>
  );
}

function SecFilingsRenderer({ data }: { data: Record<string, unknown> }) {
  const transactions = (data.insiderTransactions ?? data.transactions ?? data.filings) as Array<Record<string, unknown>> | undefined;
  if (!transactions || transactions.length === 0) {
    return <p className="text-muted-foreground">No SEC filing data available.</p>;
  }
  return (
    <div className="space-y-1">
      {transactions.slice(0, 15).map((t, i) => (
        <div key={i} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-0.5">
          <span className="font-medium min-w-20">{String(t.type ?? t.transactionType ?? "--")}</span>
          <span className="text-muted-foreground">{String(t.name ?? t.filerName ?? "--")}</span>
          <span className="ml-auto">{String(t.date ?? t.filingDate ?? "")}</span>
          {t.shares != null && <span>{String(t.shares)} shares</span>}
          {t.value != null && <span>${fmt(t.value as number)}</span>}
        </div>
      ))}
    </div>
  );
}

function EventsRenderer({ data }: { data: Record<string, unknown> }) {
  const earnings = data.earnings as Array<Record<string, unknown>> | undefined;
  const dividends = data.dividends as Array<Record<string, unknown>> | undefined;
  return (
    <div className="space-y-2">
      {earnings && earnings.length > 0 && (
        <div>
          <p className="font-medium text-muted-foreground mb-1">Earnings</p>
          {earnings.slice(0, 5).map((e, i) => (
            <div key={i} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-0.5 mb-0.5">
              <span>{String(e.date ?? "--")}</span>
              {e.epsEstimate != null && <span>Est: {fmt(e.epsEstimate as number)}</span>}
              {e.epsActual != null && <span>Act: {fmt(e.epsActual as number)}</span>}
              {e.surprise != null && (
                <span className={(e.surprise as number) >= 0 ? "text-green-600" : "text-red-600"}>
                  {(e.surprise as number) >= 0 ? "+" : ""}{fmt(e.surprise as number)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {dividends && dividends.length > 0 && (
        <div>
          <p className="font-medium text-muted-foreground mb-1">Dividends</p>
          {dividends.slice(0, 5).map((d, i) => (
            <div key={i} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-0.5 mb-0.5">
              <span>{String(d.date ?? d.exDate ?? "--")}</span>
              {d.amount != null && <span>${fmt(d.amount as number, 4)}</span>}
              {d.yield != null && <span>Yield: {pct(d.yield as number)}</span>}
            </div>
          ))}
        </div>
      )}
      {(!earnings || earnings.length === 0) && (!dividends || dividends.length === 0) && (
        <p className="text-muted-foreground">No events data available.</p>
      )}
    </div>
  );
}

function SACommentsRenderer({ data }: { data: Record<string, unknown> }) {
  const articles = data.articles as Array<{
    id: string;
    title: string;
    publishedAt: string;
    comments: Array<{ id: string; content: string; createdAt: string; likes: number }>;
  }> | undefined;

  if (!articles || articles.length === 0) {
    return <p className="text-muted-foreground">No Seeking Alpha articles or comments found.</p>;
  }

  return (
    <div className="space-y-3">
      {articles.map((article) => (
        <div key={article.id}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="font-medium leading-tight">{article.title}</p>
            <span className="text-muted-foreground whitespace-nowrap shrink-0">
              {new Date(article.publishedAt).toLocaleDateString()}
            </span>
          </div>
          {article.comments.length === 0 ? (
            <p className="text-muted-foreground italic">No comments</p>
          ) : (
            <div className="space-y-1 ml-2 border-l-2 border-border/50 pl-2">
              {article.comments.map((c) => (
                <div key={c.id} className="bg-muted/30 rounded px-2 py-1">
                  <p className="line-clamp-3">{c.content}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-muted-foreground">
                    {c.likes > 0 && <span>{c.likes} likes</span>}
                    <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FundamentalsRenderer({ data }: { data: Record<string, unknown> }) {
  const sector = data.sector as { industry?: string; category?: string; subcategory?: string } | undefined;
  const fundamentals = data.fundamentals as Record<string, number | null | undefined> | undefined;
  const volatility = data.volatility as { historical30d?: number; implied?: number } | undefined;
  const optionActivity = data.optionActivity as {
    callVolume?: number; putVolume?: number;
    callOI?: number; putOI?: number; putCallRatio?: number;
  } | undefined;
  const shortable = data.shortable as { isShortable?: boolean; sharesAvailable?: number } | undefined;

  function bigNum(n: number | null | undefined): string {
    if (n == null) return "--";
    if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${n.toLocaleString()}`;
  }

  return (
    <div className="space-y-3">
      {/* Company Info */}
      <div>
        <p className="font-medium text-muted-foreground mb-1">Company</p>
        <div className="space-y-0.5">
          <KeyValue label="Name" value={data.companyName as string | undefined} />
          <KeyValue label="Type" value={data.stockType as string | undefined} />
          {sector && (
            <>
              <KeyValue label="Industry" value={sector.industry} />
              <KeyValue label="Category" value={sector.category} />
              <KeyValue label="Subcategory" value={sector.subcategory} />
            </>
          )}
        </div>
      </div>

      {/* Fundamentals Grid */}
      {fundamentals && (
        <div>
          <p className="font-medium text-muted-foreground mb-1">Fundamentals</p>
          <div className="space-y-0.5">
            <KeyValue label="P/E" value={fundamentals.pe != null ? fmt(fundamentals.pe as number, 1) : undefined} />
            <KeyValue label="Forward P/E" value={fundamentals.forwardPe != null ? fmt(fundamentals.forwardPe as number, 1) : undefined} />
            <KeyValue label="EPS" value={fundamentals.eps != null ? `$${fmt(fundamentals.eps as number)}` : undefined} />
            <KeyValue label="EPS Growth" value={fundamentals.epsGrowth != null ? `${fmt(fundamentals.epsGrowth as number, 1)}%` : undefined} />
            <KeyValue label="Revenue" value={bigNum(fundamentals.revenue as number | undefined)} />
            <KeyValue label="Revenue Growth" value={fundamentals.revenueGrowth != null ? `${fmt(fundamentals.revenueGrowth as number, 1)}%` : undefined} />
            <KeyValue label="Market Cap" value={bigNum(fundamentals.marketCap as number | undefined)} />
            <KeyValue label="Dividend Yield" value={fundamentals.dividendYield != null ? `${fmt(fundamentals.dividendYield as number, 2)}%` : undefined} />
            <KeyValue label="Beta" value={fundamentals.beta != null ? fmt(fundamentals.beta as number) : undefined} />
            <KeyValue label="ROE" value={fundamentals.roe != null ? `${fmt(fundamentals.roe as number, 1)}%` : undefined} />
            <KeyValue label="Debt/Equity" value={fundamentals.debtToEquity != null ? fmt(fundamentals.debtToEquity as number, 1) : undefined} />
            <KeyValue label="Profit Margin" value={fundamentals.profitMargin != null ? `${fmt(fundamentals.profitMargin as number, 1)}%` : undefined} />
            <KeyValue label="Book Value" value={fundamentals.bookValue != null ? `$${fmt(fundamentals.bookValue as number)}` : undefined} />
            <KeyValue label="P/B" value={fundamentals.priceToBook != null ? fmt(fundamentals.priceToBook as number, 1) : undefined} />
            <KeyValue label="P/CF" value={fundamentals.priceToCashFlow != null ? fmt(fundamentals.priceToCashFlow as number, 1) : undefined} />
          </div>
        </div>
      )}

      {/* Volatility */}
      {volatility && (
        <div>
          <p className="font-medium text-muted-foreground mb-1">Volatility</p>
          <div className="space-y-0.5">
            <KeyValue label="HV (30d)" value={volatility.historical30d != null ? pct(volatility.historical30d) : undefined} />
            <KeyValue label="IV" value={volatility.implied != null ? pct(volatility.implied) : undefined} />
          </div>
        </div>
      )}

      {/* Option Activity */}
      {optionActivity && (
        <div>
          <p className="font-medium text-muted-foreground mb-1">Option Activity</p>
          <div className="space-y-0.5">
            <KeyValue label="Call Volume" value={optionActivity.callVolume?.toLocaleString()} />
            <KeyValue label="Put Volume" value={optionActivity.putVolume?.toLocaleString()} />
            <KeyValue label="Call OI" value={optionActivity.callOI?.toLocaleString()} />
            <KeyValue label="Put OI" value={optionActivity.putOI?.toLocaleString()} />
            <KeyValue label="Put/Call Ratio" value={optionActivity.putCallRatio != null ? fmt(optionActivity.putCallRatio) : undefined} />
          </div>
        </div>
      )}

      {/* Shortable */}
      {shortable && (
        <div>
          <p className="font-medium text-muted-foreground mb-1">Short Availability</p>
          <div className="space-y-0.5">
            <KeyValue label="Shortable" value={shortable.isShortable != null ? (shortable.isShortable ? "Yes" : "No") : undefined} />
            <KeyValue label="Shares Available" value={shortable.sharesAvailable?.toLocaleString()} />
          </div>
        </div>
      )}
    </div>
  );
}

function MacroRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <KeyValue label="VIX" value={data.vix != null ? fmt(data.vix as number, 1) : undefined} />
      <KeyValue label="VIX Trend" value={data.vixTrend as string | undefined} />
      <KeyValue label="S&P 500" value={data.sp500Index != null ? fmt(data.sp500Index as number, 0) : undefined} />
      <KeyValue label="S&P 500 Trend" value={data.sp500Trend as string | undefined} />
      <KeyValue label="Put/Call Ratio" value={data.putCallRatio != null ? fmt(data.putCallRatio as number, 3) : undefined} />
      <KeyValue label="Regime" value={data.regime as string | undefined} />
    </div>
  );
}

function FallbackRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-48 overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// --- Renderer Map ---

const renderers: Record<string, React.ComponentType<{ data: Record<string, unknown> }>> = {
  technical: TechnicalRenderer,
  options: OptionsRenderer,
  social: SocialRenderer,
  sec_filings: SecFilingsRenderer,
  events: EventsRenderer,
  sa_comments: SACommentsRenderer,
  fundamentals: FundamentalsRenderer,
  macro: MacroRenderer,
};

// --- Public Component ---

interface RawDataViewProps {
  collection: CollectionDataEntry;
}

export function RawDataView({ collection }: RawDataViewProps) {
  const Renderer = renderers[collection.source] ?? FallbackRenderer;
  return (
    <div className="text-xs">
      <Renderer data={collection.data} />
    </div>
  );
}
