import { memo } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpportunityRow } from "./OpportunityRow";
import type { DTEGroup as DTEGroupType } from "./types";

interface DTEGroupProps {
  dteGroup: DTEGroupType;
  isExpanded: boolean;
  onToggle: () => void;
}

export const DTEGroup = memo(function DTEGroup({
  dteGroup,
  isExpanded,
  onToggle,
}: DTEGroupProps) {
  // Format expiration as YYYY-MM-DD
  const formattedExpiry = `${dteGroup.expiration.slice(0, 4)}-${dteGroup.expiration.slice(4, 6)}-${dteGroup.expiration.slice(6, 8)}`;

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <TableRow
          className={cn(
            "bg-muted/10 hover:bg-muted/20 cursor-pointer select-none",
            isExpanded && "border-b-0"
          )}
        >
          <TableCell className="pl-8 py-2" colSpan={2}>
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">{dteGroup.dte} DTE</span>
              <span className="text-sm text-muted-foreground">({formattedExpiry})</span>
              <span className="text-sm text-muted-foreground ml-2">
                {dteGroup.summary.count} contract{dteGroup.summary.count !== 1 ? "s" : ""}
              </span>
            </div>
          </TableCell>
          <TableCell colSpan={3} />
          <TableCell className="text-right text-sm">
            Best: <span className="font-semibold">{dteGroup.summary.bestPremiumPercent.toFixed(2)}%</span>
          </TableCell>
          <TableCell className="text-right text-sm">
            <span className="font-semibold">{dteGroup.summary.bestAnnualReturn.toFixed(1)}%</span>
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {dteGroup.opportunities.map((opp, i) => (
          <OpportunityRow
            key={`${opp.strike}-${opp.optionType}-${i}`}
            opportunity={opp}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
});
