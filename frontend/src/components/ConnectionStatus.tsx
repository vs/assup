import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import type { FearScoreResult } from "@/lib/fearGreed";
import { getLabelColor } from "@/lib/fearGreed";
import type { MacroAnalysis } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import type { AccountSnapshot } from "@/components/common/HeaderFearGauge";

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

function getMarketStatus(): { open: boolean; label: string; time: string } | null {
  const now = new Date();
  // Get current time in US Eastern
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const weekday = etParts.find(p => p.type === "weekday")?.value ?? "";
  const hour = parseInt(etParts.find(p => p.type === "hour")?.value ?? "0");
  const minute = parseInt(etParts.find(p => p.type === "minute")?.value ?? "0");
  const etMinutes = hour * 60 + minute;

  const OPEN = 9 * 60 + 30;  // 9:30 ET
  const CLOSE = 16 * 60;     // 16:00 ET

  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const isOpen = isWeekday && etMinutes >= OPEN && etMinutes < CLOSE;

  // Calculate target time in ET, then convert to local
  let targetEtMinutes: number;
  let daysUntil = 0;

  if (isOpen) {
    targetEtMinutes = CLOSE;
  } else if (isWeekday && etMinutes < OPEN) {
    targetEtMinutes = OPEN;
  } else {
    // After close or weekend — find next weekday open
    targetEtMinutes = OPEN;
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    if (dayOfWeek === 5 && etMinutes >= CLOSE) daysUntil = 3;      // Fri after close → Mon
    else if (dayOfWeek === 6) daysUntil = 2;                        // Sat → Mon
    else if (dayOfWeek === 0) daysUntil = 1;                        // Sun → Mon
    else daysUntil = 1;                                              // weekday after close → next day
  }

  // Compute minutes until target, then derive local clock time
  const diffMinutes = targetEtMinutes - etMinutes + daysUntil * 1440;

  const targetLocal = new Date(now.getTime() + diffMinutes * 60000);
  const localTime = targetLocal.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  // Format the countdown
  const totalMin = diffMinutes;
  if (totalMin <= 0) return null;

  let countdown: string;
  if (totalMin < 120) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
  } else {
    const h = Math.round(totalMin / 60);
    countdown = `${h}h`;
  }

  return {
    open: isOpen,
    label: isOpen ? `Closes in ${countdown}` : `Opens in ${countdown}`,
    time: localTime,
  };
}

function componentScoreColor(score: number): string {
  if (score < 20) return "bg-green-600";
  if (score < 40) return "bg-green-500";
  if (score < 60) return "bg-amber-500";
  if (score < 80) return "bg-orange-500";
  return "bg-red-600";
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return formatCurrency(value);
}

type ConnectionStatusData = ReturnType<typeof useConnectionStatus>;

interface FearGreedPanelProps {
  status: ConnectionStatusData["status"];
  sseError: ConnectionStatusData["sseError"];
  result: FearScoreResult | null;
  details: MacroAnalysis["details"] | null;
  account?: AccountSnapshot | null;
}

export function FearGreedPanel({
  status,
  sseError,
  result,
  details,
  account,
}: FearGreedPanelProps) {
  const isConnected = status.connected;

  return (
    <div className="p-3">
      {/* Connection + uptime */}
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
        {isConnected && status.serverConnectionTime && (
          <span className="text-xs text-muted-foreground">
            Uptime: {formatUptime(status.serverConnectionTime)}
          </span>
        )}
      </div>

      {isConnected ? (
        <>

          {/* Market hours */}
          {(() => {
            const market = getMarketStatus();
            if (!market) return null;
            return (
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span>Market {market.open ? "closes" : "opens"} in {market.label.replace(/^(Closes|Opens) in /, "")}</span>
                <span className="tabular-nums">{market.time}</span>
              </div>
            );
          })()}

          {/* Account summary */}
          {account && (
            <div className="border-t pt-2 mb-2">
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <div className="text-muted-foreground">Net Liq</div>
                  <div className="tabular-nums">{formatCompact(account.netLiquidation)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Stocks</div>
                  <div className="tabular-nums">{formatCompact(account.stocksValue)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cash</div>
                  <div className="tabular-nums">{formatCompact(account.cashValue)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Puts</div>
                  <div className="tabular-nums">{formatCompact(account.nakedPutsExposure)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Calls</div>
                  <div className="tabular-nums">{formatCompact(account.nakedCallsExposure)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Spreads</div>
                  <div className="tabular-nums">{account.spreadsCount}</div>
                </div>
              </div>
            </div>
          )}

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
