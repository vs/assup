import { useState, useEffect, useCallback, useRef } from "react";
import { useMacro } from "./MacroProvider";
import { DailyChangeArrow } from "./DailyChangeArrow";
import { computeFearScore, getLabelColor } from "@/lib/fearGreed";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { usePositionUpdates } from "@/hooks/useSSE";
import { FearGreedPanel } from "@/components/ConnectionStatus";
import { api } from "@/api";
import { settingsApi } from "@/api/settings";
import type { PositionSummary } from "@assup/shared";
import { groupPositionsIntoSpreads } from "@/utils/spreadGrouping";

const DEFAULT_SPREAD_SYMBOLS = ["SPX", "XSP", "RUT"];

export interface AccountSnapshot {
  netLiquidation: number;
  cashValue: number;
  stocksValue: number;
  nakedPutsExposure: number;
  nakedCallsExposure: number;
  spreadsCount: number;
}

function computeAccountSnapshot(
  summary: PositionSummary,
  spreadSymbols: Set<string>,
): AccountSnapshot {
  const positions = summary.positions;

  // Separate spread-eligible options from naked options
  const spreadEligible = positions.filter(
    (p) => p.secType === "OPT" && p.underlying && spreadSymbols.has(p.underlying),
  );
  const nakedOptions = positions.filter(
    (p) => p.secType === "OPT" && !(p.underlying && spreadSymbols.has(p.underlying)),
  );

  // Group spread-eligible positions
  const { spreads } = groupPositionsIntoSpreads(spreadEligible);

  // Naked options exposure (notional value)
  const nakedPutsExposure = nakedOptions
    .filter((p) => p.right === "P")
    .reduce((s, p) => s + (p.notionalValue ?? 0), 0);
  const nakedCallsExposure = nakedOptions
    .filter((p) => p.right === "C")
    .reduce((s, p) => s + (p.notionalValue ?? 0), 0);

  return {
    netLiquidation: summary.account.netLiquidation,
    cashValue: summary.account.cashValue,
    stocksValue: summary.summary.totalStockValue,
    nakedPutsExposure,
    nakedCallsExposure,
    spreadsCount: spreads.length,
  };
}

export function HeaderFearGauge() {
  const { macro } = useMacro();
  const { status, sseError } = useConnectionStatus();
  const isConnected = status.connected;
  const [isHovering, setIsHovering] = useState(false);
  const [accountSnapshot, setAccountSnapshot] = useState<AccountSnapshot | null>(null);

  const loadAccount = useCallback(async () => {
    try {
      const [summaryData, spreadSettings] = await Promise.all([
        api.positions.summary({ includeOptions: true, optionsWeightMode: "notional" }),
        settingsApi.get<{ symbols: string[] }>("spreads").catch(() => ({ key: "spreads", value: { symbols: DEFAULT_SPREAD_SYMBOLS } })),
      ]);
      const spreadSymbols = new Set(
        spreadSettings.value?.symbols?.length > 0
          ? spreadSettings.value.symbols
          : DEFAULT_SPREAD_SYMBOLS,
      );
      setAccountSnapshot(computeAccountSnapshot(summaryData, spreadSymbols));
    } catch {
      // silent — panel just won't show account data
    }
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
  const vix = result?.components.find((c) => c.name === "VIX");
  const sp500 = result?.components.find((c) => c.name === "S&P 500");
  const dimmed = !isConnected;

  return (
    <div
      className="relative hidden md:flex items-center gap-3 text-sm"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div
        className={`flex items-center gap-3 transition-all ${dimmed ? "opacity-30 grayscale cursor-default" : "cursor-default"}`}
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
          {vix && (
            <span className="flex items-center gap-1">
              VIX: <span className="font-semibold">{vix.display}</span>
              {vix.change != null && <DailyChangeArrow change={vix.change} />}
            </span>
          )}
          {sp500 && (
            <span className="flex items-center gap-1">
              S&P: <span className="font-semibold">{sp500.display}</span>
              {sp500.change != null && <DailyChangeArrow change={sp500.change} />}
            </span>
          )}
        </div>
      </div>

      {/* Hover panel */}
      {isHovering && (
        <FearGreedPanel
          status={status}
          sseError={sseError}
          result={result}
          details={macro?.details ?? null}
          account={accountSnapshot}
        />
      )}
    </div>
  );
}
