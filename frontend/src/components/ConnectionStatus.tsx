import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import type { FearScoreResult } from "@/lib/fearGreed";
import { getLabelColor } from "@/lib/fearGreed";
import type { MacroAnalysis } from "@assup/shared";

function formatUptime(isoTime: string | null): string {
  if (!isoTime) return "Unknown";
  const diff = Date.now() - new Date(isoTime).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function formatAbsoluteChange(price: number, pctChange: number): string {
  const abs = price * pctChange / (100 + pctChange);
  const sign = abs >= 0 ? "+" : "";
  if (Math.abs(abs) >= 10) {
    return `${sign}${abs.toFixed(0)}`;
  }
  return `${sign}${abs.toFixed(1)}`;
}

function formatPctChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function changeColor(value: number, invert = false): string {
  const v = invert ? -value : value;
  if (Math.abs(v) < 0.05) return "text-muted-foreground";
  return v > 0 ? "text-green-500" : "text-red-500";
}

function componentScoreColor(score: number): string {
  if (score < 20) return "bg-green-600";
  if (score < 40) return "bg-green-500";
  if (score < 60) return "bg-amber-500";
  if (score < 80) return "bg-orange-500";
  return "bg-red-600";
}

type ConnectionStatusData = ReturnType<typeof useConnectionStatus>;

interface FearGreedPanelProps {
  status: ConnectionStatusData["status"];
  sseError: ConnectionStatusData["sseError"];
  result: FearScoreResult | null;
  details: MacroAnalysis["details"] | null;
}

export function FearGreedPanel({
  status,
  sseError,
  result,
  details,
}: FearGreedPanelProps) {
  const isConnected = status.connected;

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border bg-background p-3 shadow-lg">
      {/* Connection section */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected
                ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]"
                : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
            }`}
          />
          <span className="text-xs font-medium">
            {isConnected ? "Live" : "Disconnected"}
          </span>
        </div>
        {isConnected && status.account && (
          <span className="text-xs text-muted-foreground">{status.account}</span>
        )}
      </div>

      {isConnected ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
            {status.serverVersion && <span>Server v{status.serverVersion}</span>}
            {status.serverConnectionTime && (
              <span>Uptime: {formatUptime(status.serverConnectionTime)}</span>
            )}
          </div>

          {/* Market data section */}
          {details && (
            <>
              <div className="border-t pt-2 mb-2">
                {/* VIX row */}
                {details.vix != null && (
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs font-medium w-12">VIX</span>
                    <span className="text-xs font-semibold tabular-nums">{details.vix.toFixed(2)}</span>
                    {details.vixChange != null && (
                      <span className={`text-xs tabular-nums ${changeColor(details.vixChange, true)}`}>
                        {formatAbsoluteChange(details.vix, details.vixChange)} ({formatPctChange(details.vixChange)})
                      </span>
                    )}
                    {details.vixSma20 != null && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        SMA20: {details.vixSma20.toFixed(1)}
                      </span>
                    )}
                  </div>
                )}

                {/* S&P 500 row */}
                {details.sp500Index != null && (
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs font-medium w-12">S&P</span>
                    <span className="text-xs font-semibold tabular-nums">
                      {details.sp500Index.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                    {details.sp500Change != null && (
                      <span className={`text-xs tabular-nums ${changeColor(details.sp500Change)}`}>
                        {formatAbsoluteChange(details.sp500Index, details.sp500Change)} ({formatPctChange(details.sp500Change)})
                      </span>
                    )}
                    {details.sp500Sma200 != null && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        SMA200: {details.sp500Sma200.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Fear/Greed component breakdown */}
              {result && (
                <div className="border-t pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">Fear/Greed Index</span>
                    <span className={`text-sm font-bold tabular-nums ${getLabelColor(result.score)}`}>
                      {result.score} {result.label}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {result.components.map((c) => (
                      <div key={c.name} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16 shrink-0">{c.name}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${componentScoreColor(c.score)}`}
                            style={{ width: `${c.score}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground w-6 text-right">{c.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground break-words">
            {sseError || status.error}
          </p>
          {!sseError && (
            <ul className="mt-2 pt-2 border-t text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Check TWS is running</li>
              <li>Enable API in TWS settings</li>
              <li>Port: 7497 (paper) / 7496 (live)</li>
              <li>Add trusted IP in TWS</li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}
