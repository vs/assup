import { memo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpportunityRow } from "./OpportunityRow";
import type { DTEGroup as DTEGroupType, ExtendedOptionOpportunity } from "./types";

interface DTEGroupProps {
  dteGroup: DTEGroupType;
  isExpanded: boolean;
  onToggle: () => void;
  gridCols: string;
  onSellClick?: (opportunity: ExtendedOptionOpportunity) => void;
}

export const DTEGroup = memo(function DTEGroup({
  dteGroup,
  isExpanded,
  onToggle,
  gridCols,
  onSellClick,
}: DTEGroupProps) {
  // Format expiration as YYYY-MM-DD
  const formattedExpiry = `${dteGroup.expiration.slice(0, 4)}-${dteGroup.expiration.slice(4, 6)}-${dteGroup.expiration.slice(6, 8)}`;

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "grid w-full items-center bg-muted/10 hover:bg-muted/20 cursor-pointer select-none border-b py-2",
            isExpanded && "border-b-0"
          )}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="flex items-center gap-2 pl-8 col-span-3">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium text-sm">{dteGroup.dte} DTE</span>
            <span className="text-sm text-muted-foreground">({formattedExpiry})</span>
            <span className="text-sm text-muted-foreground ml-2">
              {dteGroup.summary.count} contract{dteGroup.summary.count !== 1 ? "s" : ""}
            </span>
          </div>
          <div />
          <div />
          <div />
          <div />
          <div className="text-right text-sm pr-2">
            Best: <span className="font-semibold">{dteGroup.summary.bestPremiumPercent.toFixed(2)}%</span>
          </div>
          <div className="text-right text-sm pr-2">
            <span className="font-semibold">{dteGroup.summary.bestAnnualReturn.toFixed(1)}%</span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Inline column header - shows when DTE group is expanded */}
        <div
          className="grid w-full bg-muted/5 text-xs text-muted-foreground border-b"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="pl-14 py-1 font-medium">Contract</div>
          <div className="text-right py-1 pr-2">Strike</div>
          <div className="text-right py-1 pr-2">Price</div>
          <div className="text-right py-1 pr-2">Bid</div>
          <div className="text-right py-1 pr-2">Ask</div>
          <div className="text-right py-1 pr-2">Premium</div>
          <div className="text-right py-1 pr-2">Delta</div>
          <div className="text-right py-1 pr-2">Premium %</div>
          <div className="text-right py-1 pr-2">Annual</div>
          <div className="text-right py-1 pr-2">Action</div>
        </div>
        {dteGroup.opportunities.map((opp, i) => (
          <OpportunityRow
            key={`${opp.strike}-${opp.optionType}-${i}`}
            opportunity={opp}
            gridCols={gridCols}
            onSellClick={onSellClick}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
