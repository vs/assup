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

function AnalystConsensusRenderer({ data }: { data: Record<string, unknown> }) {
  const ratings = data.ratings as Array<Record<string, unknown>> | undefined;
  const consensus = data as Record<string, unknown>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <KeyValue label="Buy" value={String(consensus.buy ?? consensus.strongBuy ?? "--")} />
        <KeyValue label="Hold" value={String(consensus.hold ?? "--")} />
        <KeyValue label="Sell" value={String(consensus.sell ?? consensus.strongSell ?? "--")} />
      </div>
      {consensus.targetPrice != null && (
        <KeyValue label="Target Price" value={`$${fmt(consensus.targetPrice as number)}`} />
      )}
      {consensus.averageTarget != null && (
        <KeyValue label="Avg Target" value={`$${fmt(consensus.averageTarget as number)}`} />
      )}
      {ratings && ratings.length > 0 && (
        <div className="space-y-1 mt-2">
          <p className="font-medium text-muted-foreground">Recent Ratings</p>
          {ratings.slice(0, 8).map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <span className="font-medium">{String(r.firm ?? r.analyst ?? "--")}</span>
              <span>{String(r.rating ?? r.action ?? "--")}</span>
              {r.targetPrice != null && <span className="ml-auto">${fmt(r.targetPrice as number)}</span>}
              {r.date && <span>{String(r.date)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShortInterestRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <KeyValue label="Short Interest" value={data.shortInterest != null ? String(data.shortInterest) : undefined} />
      <KeyValue label="Short % of Float" value={data.shortPercentOfFloat != null ? pct(data.shortPercentOfFloat as number) : undefined} />
      <KeyValue label="Short Ratio" value={data.shortRatio != null ? fmt(data.shortRatio as number) : undefined} />
      <KeyValue label="Days to Cover" value={data.daysToCover != null ? fmt(data.daysToCover as number, 1) : undefined} />
      <KeyValue label="Change" value={data.change != null ? pct(data.change as number) : undefined} />
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

function SeekingAlphaRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-48 overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function MacroRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <KeyValue label="VIX" value={data.vix != null ? fmt(data.vix as number, 1) : undefined} />
      <KeyValue label="VIX Trend" value={data.vixTrend as string | undefined} />
      <KeyValue label="S&P 500" value={data.sp500Price != null ? fmt(data.sp500Price as number) : undefined} />
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
  analyst_consensus: AnalystConsensusRenderer,
  short_interest: ShortInterestRenderer,
  events: EventsRenderer,
  seeking_alpha: SeekingAlphaRenderer,
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
