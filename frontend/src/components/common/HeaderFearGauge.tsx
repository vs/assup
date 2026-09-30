import { useState, useEffect, useCallback, useRef } from "react";
import { useMacro } from "./MacroProvider";
import { DailyChangeArrow } from "./DailyChangeArrow";
import { computeFearScore, getLabelColor } from "@/lib/fearGreed";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { usePositionUpdates } from "@/hooks/useSSE";
import { FearGreedPanel } from "@/components/ConnectionStatus";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { api } from "@/api";
import { settingsApi } from "@/api/settings";
import type { PositionSummary } from "@assup/shared";
import { groupPositionsIntoSpreads } from "@/utils/spreadGrouping";

const DEFAULT_SPREAD_SYMBOLS = ["SPX", "XSP", "RUT"];

export interface AccountSnapshot {
  netLiquidation: number;
  cashValue: number;
  stocksValue: number;
  putsExposure: number;
  callsExposure: number;
  spreadsCount: number;
}

function computeAccountSnapshot(
  summary: PositionSummary,
  spreadSymbols: Set<string>,
): AccountSnapshot {
  // Use pre-computed summary totals for exposure (includes ALL options)
  const spreadEligible = summary.positions.filter(
    (p) => p.secType === "OPT" && p.underlying && spreadSymbols.has(p.underlying),
  );
  const { spreads } = groupPositionsIntoSpreads(spreadEligible);

  return {
    netLiquidation: summary.account.netLiquidation,
    cashValue: summary.account.cashValue,
    stocksValue: summary.summary.totalStockValue,
    putsExposure: summary.summary.totalPutNotional,
    callsExposure: summary.summary.totalCallNotional,
    spreadsCount: spreads.length,
  };
}

async function fetchAccountSnapshot(): Promise<AccountSnapshot> {
  const [summaryData, spreadSettings] = await Promise.all([
    api.positions.summary({ includeOptions: true, optionsWeightMode: "notional" }),
    settingsApi.get<{ symbols: string[] }>("spreads").catch(() => ({ key: "spreads", value: { symbols: DEFAULT_SPREAD_SYMBOLS } })),
  ]);
  const spreadSymbols = new Set(
    spreadSettings.value?.symbols?.length > 0
      ? spreadSettings.value.symbols
      : DEFAULT_SPREAD_SYMBOLS,
  );
  return computeAccountSnapshot(summaryData, spreadSymbols);
}

export function HeaderFearGauge() {
  const { macro } = useMacro();
  const { status, sseError } = useConnectionStatus();
  const isConnected = status.connected;
  const [accountSnapshot, setAccountSnapshot] = useState<AccountSnapshot | null>(null);

  const loadAccount = useCallback(() => {
    fetchAccountSnapshot()
      .then(setAccountSnapshot)
      .catch(() => {
        // silent — panel just won't show account data
      });
  }, []);

  useEffect(() => {
    if (isConnected) loadAccount();
  }, [isConnected, loadAccount]);

  const loadAccountRef = useRef(loadAccount);
  useEffect(() => { loadAccountRef.current = loadAccount; });
  usePositionUpdates(useCallback(() => loadAccountRef.current(), []));

  const result = macro ? computeFearScore(macro.details) : null;

  if (!result && isConnected) return null;

  const labelColor = result ? getLabelColor(result.score) : "";
  // Display live values straight from macro details — the score components
  // require indicator data (e.g. SMA200) that may be missing from the
  // baseline snapshot, and price display must not depend on it.
  const details = macro?.details ?? null;
  const dimmed = !isConnected;

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="hidden md:flex shrink-0 items-center gap-3 text-sm cursor-default">
          <div
            className={`flex items-center gap-3 transition-all ${dimmed ? "opacity-30 grayscale" : ""}`}
          >
            {/* Gauge */}
            <div className="flex items-center gap-2 min-w-[160px]">
              <span className={`text-base font-bold tabular-nums ${dimmed ? "text-muted-foreground" : labelColor}`}>
                {result?.score ?? "—"}
              </span>
              <div
                className="relative flex-1 h-2 rounded-full overflow-hidden"
                style={{
                  background: dimmed
                    ? "linear-gradient(to right, #6b7280, #9ca3af, #6b7280)"
                    : "linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)",
                }}
              >
                {result && (
                  <div
                    className="absolute top-[-1px] w-[3px] h-[10px] bg-white rounded-full border border-gray-500"
                    style={{
                      left: `${result.score}%`,
                      transform: "translateX(-50%)",
                    }}
                  />
                )}
              </div>
              <span className={`text-xs font-semibold whitespace-nowrap ${dimmed ? "text-muted-foreground" : labelColor}`}>
                {result?.label ?? "Disconnected"}
              </span>
            </div>

            {/* VIX + S&P details */}
            <div className="hidden lg:flex items-center gap-3 text-xs text-muted-foreground">
              {details?.vix != null && (
                <span className="flex items-center gap-1">
                  VIX: <span className="font-semibold">{details.vix.toFixed(1)}</span>
                  {details.vixChange != null && <DailyChangeArrow change={details.vixChange} />}
                </span>
              )}
              {details?.sp500Index != null && (
                <span className="flex items-center gap-1">
                  S&P:{" "}
                  <span className="font-semibold">
                    {details.sp500Index.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </span>
                  {details.sp500Change != null && <DailyChangeArrow change={details.sp500Change} />}
                </span>
              )}
            </div>
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-80 p-0 border-border bg-background"
        side="bottom"
        align="end"
        sideOffset={5}
      >
        <FearGreedPanel
          status={status}
          sseError={sseError}
          result={result}
          details={macro?.details ?? null}
          account={accountSnapshot}
        />
      </HoverCardContent>
    </HoverCard>
  );
}
