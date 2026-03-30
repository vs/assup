import { useState } from "react";
import type { WheelScanResult } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Check, Loader2 } from "lucide-react";
import { researchApi } from "@/api";

interface CandidateCardProps {
  result: WheelScanResult;
  assetClassName?: string;
  assetClassColor?: string;
  isTracked: boolean;
  onAdded: (symbol: string) => void;
}

function formatMarketCap(value: number | null): string {
  if (value == null) return "\u2014";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

export function CandidateCard({
  result,
  assetClassName,
  assetClassColor,
  isTracked,
  onAdded,
}: CandidateCardProps) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function handleAdd() {
    setAdding(true);
    try {
      await researchApi.addTickers({ symbols: [result.symbol], source: "wheel_scanner" });
      setAdded(true);
      onAdded(result.symbol);
    } catch (err) {
      console.error("Failed to add ticker:", err);
    } finally {
      setAdding(false);
    }
  }

  const disabled = isTracked || added || adding;

  return (
    <Card className="relative">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{result.symbol}</span>
            <Badge variant="outline" className="text-xs">
              {result.source}
            </Badge>
          </div>
          <span className={`text-2xl font-bold tabular-nums ${scoreColor(result.compositeScore)}`}>
            {Math.round(result.compositeScore)}
          </span>
        </div>

        {/* Asset class */}
        {assetClassName && (
          <div className="flex items-center gap-1.5">
            {assetClassColor && (
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: assetClassColor }}
              />
            )}
            <span className="text-xs text-muted-foreground">{assetClassName}</span>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Price</span>
            <span className="font-medium">
              {result.lastPrice != null ? `$${result.lastPrice.toFixed(2)}` : "\u2014"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mkt Cap</span>
            <span className="font-medium">{formatMarketCap(result.marketCap)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Premium</span>
            <span className="font-medium">
              {result.premiumYield != null ? `${result.premiumYield.toFixed(1)}%` : "\u2014"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">IV Rank</span>
            <span className="font-medium">
              {result.ivRank != null ? Math.round(result.ivRank) : "\u2014"}
            </span>
          </div>
        </div>

        {/* Action */}
        <Button
          variant={disabled ? "ghost" : "default"}
          size="sm"
          className="w-full"
          disabled={disabled}
          onClick={handleAdd}
        >
          {adding ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Adding...
            </>
          ) : isTracked || added ? (
            <>
              <Check className="h-4 w-4 mr-1.5" />
              {result.reportTriggered ? "Report Pending" : "Already Tracked"}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1.5" />
              Add to Research
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
