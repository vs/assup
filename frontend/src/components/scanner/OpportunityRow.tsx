import { memo } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@assup/shared";
import type { ExtendedOptionOpportunity } from "./types";

interface OpportunityRowProps {
  opportunity: ExtendedOptionOpportunity;
}

export const OpportunityRow = memo(function OpportunityRow({
  opportunity: opp,
}: OpportunityRowProps) {
  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="pl-14 text-right font-mono">${opp.strike}</TableCell>
      <TableCell>
        <Badge variant={opp.optionType === "PUT" ? "danger" : "success"}>
          {opp.optionType}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(opp.bid, { maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(opp.ask, { maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(opp.midPrice, { maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right">{opp.premiumPercent?.toFixed(2)}%</TableCell>
      <TableCell className="text-right font-semibold">{opp.annualizedReturn?.toFixed(1)}%</TableCell>
    </TableRow>
  );
});
