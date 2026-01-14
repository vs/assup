import { memo } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@assup/shared";
import { DTEGroup } from "./DTEGroup";
import type { TickerGroup as TickerGroupType } from "./types";

interface TickerGroupProps {
  tickerGroup: TickerGroupType;
  isExpanded: boolean;
  onToggle: () => void;
  expandedDTEs: Set<string>;
  onToggleDTE: (dteKey: string) => void;
}

export const TickerGroup = memo(function TickerGroup({
  tickerGroup,
  isExpanded,
  onToggle,
  expandedDTEs,
  onToggleDTE,
}: TickerGroupProps) {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <TableRow
          className={cn(
            "bg-muted/30 hover:bg-muted/40 cursor-pointer select-none",
            isExpanded && "border-b-0"
          )}
        >
          <TableCell className="pl-2 py-3">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: tickerGroup.assetClassColor }}
              />
              <span className="font-semibold text-base">{tickerGroup.symbol}</span>
              <span className="text-sm text-muted-foreground">
                ({tickerGroup.assetClassName})
              </span>
            </div>
          </TableCell>
          <TableCell className="font-mono">
            {tickerGroup.underlyingPrice
              ? formatCurrency(tickerGroup.underlyingPrice, { maximumFractionDigits: 2 })
              : <span className="text-muted-foreground">N/A</span>
            }
          </TableCell>
          <TableCell colSpan={2}>
            {tickerGroup.summary.totalCount} contract{tickerGroup.summary.totalCount !== 1 ? "s" : ""}
          </TableCell>
          <TableCell className="text-right" colSpan={2}>
            Best: <span className="font-semibold">{tickerGroup.summary.bestAnnualReturn.toFixed(1)}%</span>
          </TableCell>
          <TableCell className="text-right text-muted-foreground">
            {tickerGroup.summary.uniqueExpirations} expiration{tickerGroup.summary.uniqueExpirations !== 1 ? "s" : ""}
          </TableCell>
        </TableRow>
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
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
});
