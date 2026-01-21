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
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "grid w-full items-center bg-muted/30 hover:bg-muted/40 cursor-pointer select-none border-b py-3",
            isExpanded && "border-b-0"
          )}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="flex items-center gap-2 pl-2 col-span-3">
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            )}
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: tickerGroup.assetClassColor }}
            />
            <span className="font-semibold text-base">{tickerGroup.symbol}</span>
            {tickerGroup.underlyingPrice && (
              <span className="font-mono text-sm text-muted-foreground">
                {formatCurrency(tickerGroup.underlyingPrice, { maximumFractionDigits: 2 })}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              ({tickerGroup.assetClassName})
            </span>
            <span className="text-sm text-muted-foreground ml-auto mr-4">
              {tickerGroup.summary.totalCount} contract{tickerGroup.summary.totalCount !== 1 ? "s" : ""}, {tickerGroup.summary.uniqueExpirations} expiration{tickerGroup.summary.uniqueExpirations !== 1 ? "s" : ""}
            </span>
          </div>
          <div />
          <div />
          <div />
          <div />
          <div className="text-right pr-2">
            Best: <span className="font-semibold">{tickerGroup.summary.bestPremiumPercent.toFixed(2)}%</span>
          </div>
          <div className="text-right pr-2">
            <span className="font-semibold">{tickerGroup.summary.bestAnnualReturn.toFixed(1)}%</span>
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
