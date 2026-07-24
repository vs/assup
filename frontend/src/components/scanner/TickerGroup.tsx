import { memo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@assup/shared";
import { DTEGroup } from "./DTEGroup";
import type { TickerGroup as TickerGroupType, ExtendedOptionOpportunity } from "./types";

interface TickerGroupProps {
  tickerGroup: TickerGroupType;
  isExpanded: boolean;
  onToggle: () => void;
  expandedDTEs: Set<string>;
  onToggleDTE: (dteKey: string) => void;
  gridCols: string;
  onSellClick?: (opportunity: ExtendedOptionOpportunity) => void;
}

export const TickerGroup = memo(function TickerGroup({
  tickerGroup,
  isExpanded,
  onToggle,
  expandedDTEs,
  onToggleDTE,
  gridCols,
  onSellClick,
}: TickerGroupProps) {
  const hasPosition = tickerGroup.shares != null || tickerGroup.avgCost != null || tickerGroup.wheelCostBasis != null;

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "w-full bg-muted/30 hover:bg-muted/40 cursor-pointer select-none border-b px-3 py-2.5",
            isExpanded && "border-b-0"
          )}
        >
          {/* Row 1: Labels */}
          <div className="flex items-center gap-6 text-[11px] text-muted-foreground/70 uppercase tracking-wider mb-1 pl-0.5">
            <span className="w-4 shrink-0" />
            <span className="w-[80px]">Symbol</span>
            <span className="w-[80px]">Price</span>
            <span className="w-[120px]">Asset Class</span>
            {hasPosition && (
              <>
                <span className="w-[60px] text-right">Shares</span>
                <span className="w-[80px] text-right">Avg Cost</span>
                <span className="w-[80px] text-right">Basis</span>
              </>
            )}
            <span className="ml-auto w-[130px] text-right">Contracts</span>
            <span className="w-[80px] text-right">Best Prem</span>
            <span className="w-[80px] text-right">Best Ann</span>
          </div>
          {/* Row 2: Values */}
          <div className="flex items-center gap-6 pl-0.5">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="flex items-center gap-1.5 w-[80px]">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: tickerGroup.assetClassColor }}
              />
              <span className="font-semibold text-sm">{tickerGroup.symbol}</span>
            </div>
            <span className="font-mono text-sm w-[80px]">
              {tickerGroup.underlyingPrice
                ? formatCurrency(tickerGroup.underlyingPrice, { maximumFractionDigits: 2 })
                : "—"}
            </span>
            <span className="text-sm text-muted-foreground truncate w-[120px]">
              {tickerGroup.assetClassName}
            </span>
            {hasPosition && (
              <>
                <span className="font-mono text-sm w-[60px] text-right">
                  {tickerGroup.shares != null && tickerGroup.shares !== 0
                    ? tickerGroup.shares
                    : "—"}
                </span>
                <span className="font-mono text-sm text-muted-foreground w-[80px] text-right">
                  {tickerGroup.avgCost != null
                    ? formatCurrency(tickerGroup.avgCost, { maximumFractionDigits: 2 })
                    : "—"}
                </span>
                <span className="font-mono text-sm text-blue-500 w-[80px] text-right" title="Wheel-adjusted cost basis">
                  {tickerGroup.wheelCostBasis != null && tickerGroup.wheelCostBasis > 0
                    ? formatCurrency(tickerGroup.wheelCostBasis, { maximumFractionDigits: 2 })
                    : "—"}
                </span>
              </>
            )}
            <span className="text-sm text-muted-foreground ml-auto w-[130px] text-right">
              {tickerGroup.summary.totalCount} contract{tickerGroup.summary.totalCount !== 1 ? "s" : ""}, {tickerGroup.summary.uniqueExpirations} exp
            </span>
            <span className="font-mono text-sm font-semibold w-[80px] text-right">
              {tickerGroup.summary.bestPremiumPercent.toFixed(2)}%
            </span>
            <span className="font-mono text-sm font-semibold w-[80px] text-right">
              {tickerGroup.summary.bestAnnualReturn.toFixed(1)}%
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {tickerGroup.dteGroups.map((dteGroup) => {
          const dteKey = `${tickerGroup.symbol}-${dteGroup.dte}`;
          return (
            <DTEGroup
              key={dteKey}
              dteGroup={dteGroup}
              isExpanded={expandedDTEs.has(dteKey)}
              onToggle={() => onToggleDTE(dteKey)}
              gridCols={gridCols}
              onSellClick={onSellClick}
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
});
