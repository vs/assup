/**
 * Per-ticker log of everything that produced profit or loss: option
 * round-trips, share lots, and dividends. Renders nothing when the symbol has
 * no imported history.
 */

import { useEffect, useState } from "react";
import { formatCurrency } from "@assup/shared";
import type { TickerActivity, TickerActivityEntry } from "@assup/shared";
import { api } from "@/api";
import { Card, CardContent } from "@/components/ui/card";

const COLLAPSED_COUNT = 10;

const STATUS_LABELS: Record<TickerActivityEntry["status"], string> = {
  open: "open",
  closed: "closed",
  expired: "expired",
  assigned: "assigned",
  called_away: "called away",
  paid: "paid",
};

/**
 * On a ticker page the symbol is implied, so strip it from the row label:
 *   "TLT Jul24'26 89 CALL" -> "Jul24'26 89 CALL"
 *   "200 TLT"              -> "200 shares"
 * Dividend labels and any unrecognised shape pass through unchanged.
 */
function shortLabel(displayName: string, symbol: string): string {
  if (displayName.startsWith(`${symbol} `)) {
    return displayName.slice(symbol.length + 1);
  }
  if (displayName.endsWith(` ${symbol}`)) {
    return `${displayName.slice(0, -(symbol.length + 1))} shares`;
  }
  return displayName;
}

function Money({ value, muted = false }: { value: number; muted?: boolean }) {
  const tone = muted
    ? "text-muted-foreground"
    : value >= 0
      ? "text-green-600"
      : "text-red-600";
  return (
    <span className={`tabular-nums ${tone}`}>
      {value >= 0 ? "+" : ""}
      {formatCurrency(value)}
    </span>
  );
}

function LegRow({ label, date, action, amount }: {
  label: string;
  date: string;
  action: string;
  amount: number | null;
}) {
  return (
    <tr className="text-muted-foreground">
      <td className="py-0.5 pr-3 whitespace-nowrap w-px">{label}</td>
      <td className="py-0.5 pr-3 whitespace-nowrap w-px">{date}</td>
      <td className="py-0.5 pr-3 w-full">{action}</td>
      <td className="py-0.5 text-right tabular-nums whitespace-nowrap w-px">
        {amount !== null ? formatCurrency(amount) : "—"}
      </td>
    </tr>
  );
}

function EntryRow({ entry, symbol }: { entry: TickerActivityEntry; symbol: string }) {
  const [expanded, setExpanded] = useState(false);

  const priceSuffix = (price: number | null) =>
    price != null && price > 0 ? ` @ $${price.toFixed(2)}` : "";

  // Commissions are already folded into each leg's total by the backend, so the
  // gap between the legs and the net P&L is what was paid in fees.
  const legSum = (entry.openLeg?.total ?? 0) + (entry.closeLeg?.total ?? 0);
  const commission = entry.realizedPnL !== null ? entry.realizedPnL - legSum : null;

  return (
    <>
      <tr
        className="border-b border-border/30 last:border-0 cursor-pointer hover:bg-muted/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap w-px">
          {entry.sortDate || "—"}
        </td>
        <td className="py-1 pr-3 w-full">{shortLabel(entry.displayName, symbol)}</td>
        <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap w-px">
          {STATUS_LABELS[entry.status]}
        </td>
        <td className="py-1 text-right whitespace-nowrap w-px font-medium">
          {entry.realizedPnL !== null ? (
            <Money value={entry.realizedPnL} />
          ) : entry.unrealizedPnL !== null ? (
            <>
              <Money value={entry.unrealizedPnL} />
              <span className="text-muted-foreground ml-1">unreal.</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/30 last:border-0">
          <td colSpan={4} className="py-1 pl-4">
            <table className="w-full text-xs">
              <tbody>
                {entry.openLeg && (
                  <LegRow
                    label="Open"
                    date={entry.openLeg.date}
                    action={`${entry.openLeg.action}${priceSuffix(entry.openLeg.price)}`}
                    amount={entry.openLeg.total}
                  />
                )}
                {entry.closeLeg && (
                  <LegRow
                    label="Close"
                    date={entry.closeLeg.date}
                    action={`${entry.closeLeg.action}${priceSuffix(entry.closeLeg.price)}`}
                    amount={entry.closeLeg.total}
                  />
                )}
                {entry.dividend && (
                  <LegRow
                    label="Tax"
                    date={entry.sortDate}
                    action="Withholding tax"
                    amount={entry.dividend.withholdingTax}
                  />
                )}
                {!entry.dividend && commission !== null && Math.abs(commission) > 0.005 && (
                  <LegRow label="Fees" date="" action="Commission" amount={commission} />
                )}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export function TickerActivityLog({ symbol }: { symbol: string }) {
  const [data, setData] = useState<TickerActivity | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setShowAll(false);
    api.profit
      .tickerActivity(symbol)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (!data || (data.open.length === 0 && data.closed.length === 0)) return null;

  const { summary } = data;
  const visible = showAll ? data.closed : data.closed.slice(0, COLLAPSED_COUNT);

  return (
    <Card className="max-w-3xl">
      <CardContent className="py-3 px-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3">
          <span className="text-sm font-medium">Activity</span>
          <span className="text-sm">
            Realized <Money value={summary.total} />
          </span>
          <span className="text-xs text-muted-foreground">
            Options <Money value={summary.optionsPnL} /> · Stock{" "}
            <Money value={summary.stockPnL} /> · Dividends{" "}
            <Money value={summary.dividends} />
          </span>
        </div>

        {data.open.length > 0 && (
          <>
            <h4 className="text-xs font-medium text-muted-foreground mb-1">Open</h4>
            <table className="text-xs w-full mb-3">
              <tbody>
                {data.open.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} symbol={symbol} />
                ))}
              </tbody>
            </table>
          </>
        )}

        {data.closed.length > 0 && (
          <>
            <h4 className="text-xs font-medium text-muted-foreground mb-1">History</h4>
            <table className="text-xs w-full">
              <tbody>
                {visible.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} symbol={symbol} />
                ))}
              </tbody>
            </table>
            {data.closed.length > COLLAPSED_COUNT && (
              <button
                type="button"
                className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show less" : `Show all ${data.closed.length} entries`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
