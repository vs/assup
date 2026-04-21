import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useTickerProfile } from "../../hooks/useTickerProfile";
import { AreaChart, Area, YAxis, ResponsiveContainer } from "recharts";
import type { Recommendation } from "@assup/shared";

interface TickerHoverCardProps {
  symbol: string;
  children: React.ReactNode;
}

const RECOMMENDATION_COLORS: Record<Recommendation, string> = {
  buy: "bg-green-600",
  sell: "bg-red-600",
  avoid: "bg-red-600",
  hold: "bg-amber-600",
  wheel: "bg-blue-600",
};

function formatMarketCap(value: number | null): string {
  if (value === null) return "\u2014";
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  return value.toLocaleString();
}

function ProfileSkeleton() {
  return (
    <div className="w-[340px] space-y-3 p-4">
      <div className="flex justify-between">
        <div className="space-y-2">
          <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          <div className="flex gap-1.5">
            <div className="h-5 w-20 bg-muted animate-pulse rounded" />
            <div className="h-5 w-24 bg-muted animate-pulse rounded" />
          </div>
        </div>
        <div className="h-6 w-12 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-4 w-full bg-muted animate-pulse rounded" />
      <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
      <div className="h-[80px] w-full bg-muted animate-pulse rounded" />
      <div className="flex justify-between">
        <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        <div className="h-4 w-16 bg-muted animate-pulse rounded" />
      </div>
    </div>
  );
}

export function TickerHoverCard({ symbol, children }: TickerHoverCardProps) {
  const { data: profile, isLoading, isError } = useTickerProfile(symbol);

  const chartColor =
    profile?.chart && profile.chart.length >= 2
      ? profile.chart[profile.chart.length - 1].close >= profile.chart[0].close
        ? "#22c55e"
        : "#ef4444"
      : "#22c55e";

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        className="w-auto p-0 border-border bg-popover"
        side="bottom"
        align="start"
        sideOffset={5}
      >
        {isLoading ? (
          <ProfileSkeleton />
        ) : isError || !profile ? (
          <div className="w-[340px] p-4 text-center">
            <span className="font-bold text-base">{symbol}</span>
            <p className="text-xs text-muted-foreground mt-2">No data available</p>
          </div>
        ) : (
          <div className="w-[340px] p-4 space-y-2.5">
            {/* Header: symbol + company name | recommendation */}
            <div className="flex justify-between items-start">
              <div className="min-w-0">
                <span className="font-bold text-base">
                  {profile.symbol}
                </span>{" "}
                <span className="text-sm text-muted-foreground">
                  {profile.companyName}
                </span>
              </div>
              {profile.recommendation && (
                <div className="flex flex-col items-end ml-2 shrink-0">
                  <span
                    className={`text-xs font-semibold text-white px-2 py-0.5 rounded ${
                      RECOMMENDATION_COLORS[profile.recommendation] || "bg-gray-600"
                    }`}
                  >
                    {profile.recommendation.toUpperCase()}
                  </span>
                  {profile.confidence !== null && (
                    <span className="text-[11px] text-muted-foreground mt-0.5">
                      {Math.round(profile.confidence * 100)}% conf.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="flex gap-1.5 flex-wrap">
              {profile.sector && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-950 text-blue-400">
                  {profile.sector}
                </span>
              )}
              {profile.industry && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-950 text-blue-400">
                  {profile.industry}
                </span>
              )}
              {profile.marketPosition && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-green-950 text-green-400">
                  {profile.marketPosition}
                </span>
              )}
            </div>

            {/* Description */}
            {profile.description && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {profile.description}
              </p>
            )}

            {/* Chart */}
            {profile.chart.length > 0 ? (
              <div className="h-[80px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={profile.chart}>
                    <defs>
                      <linearGradient
                        id={`gradient-${symbol}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={chartColor}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="100%"
                          stopColor={chartColor}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <YAxis domain={["dataMin", "dataMax"]} hide />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={chartColor}
                      strokeWidth={1.5}
                      fill={`url(#gradient-${symbol})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[80px] w-full flex items-center justify-center text-xs text-muted-foreground bg-muted/30 rounded">
                Chart unavailable
              </div>
            )}

            {/* Metrics row */}
            <div className="flex justify-between text-[11px]">
              <div>
                <span className="text-muted-foreground">MCap </span>
                <span>{formatMarketCap(profile.marketCap)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">P/E </span>
                <span>
                  {profile.peRatio !== null
                    ? profile.peRatio.toFixed(1)
                    : "\u2014"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Div </span>
                <span>
                  {profile.dividendYield !== null
                    ? `${profile.dividendYield.toFixed(2)}%`
                    : "\u2014"}
                </span>
              </div>
            </div>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
