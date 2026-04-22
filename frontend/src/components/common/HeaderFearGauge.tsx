import { useMacro } from "./MacroProvider";
import { DailyChangeArrow } from "./DailyChangeArrow";
import { computeFearScore, getLabelColor } from "@/lib/fearGreed";

export function HeaderFearGauge() {
  const { macro } = useMacro();

  if (!macro) return null;

  const result = computeFearScore(macro.details);
  if (!result) return null;

  const labelColor = getLabelColor(result.score);

  const vix = result.components.find((c) => c.name === "VIX");
  const sp500 = result.components.find((c) => c.name === "S&P 500");

  return (
    <div className="hidden md:flex items-center gap-3 text-sm">
      {/* Gauge */}
      <div className="flex items-center gap-2 min-w-[160px]">
        <span className={`text-base font-bold tabular-nums ${labelColor}`}>
          {result.score}
        </span>
        <div
          className="relative flex-1 h-2 rounded-full overflow-hidden"
          style={{
            background:
              "linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)",
          }}
        >
          <div
            className="absolute top-[-1px] w-[3px] h-[10px] bg-white rounded-full border border-gray-500"
            style={{
              left: `${result.score}%`,
              transform: "translateX(-50%)",
            }}
          />
        </div>
        <span className={`text-xs font-semibold whitespace-nowrap ${labelColor}`}>
          {result.label}
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
  );
}
