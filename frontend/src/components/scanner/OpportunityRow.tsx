import { memo } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import type { ExtendedOptionOpportunity } from "./types";

interface OpportunityRowProps {
  opportunity: ExtendedOptionOpportunity;
}

export const OpportunityRow = memo(function OpportunityRow({
  opportunity: opp,
}: OpportunityRowProps) {
  const contractName = formatDisplayName({
    symbol: opp.symbol,
    secType: "OPT",
    strike: opp.strike,
    right: opp.optionType === "PUT" ? "P" : "C",
    lastTradeDateOrContractMonth: opp.expiration,
  });

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="pl-14 font-medium">{contractName}</TableCell>
      <TableCell className="text-right font-mono">
        {opp.underlyingPrice
          ? formatCurrency(opp.underlyingPrice, { maximumFractionDigits: 2 })
          : <span className="text-muted-foreground">N/A</span>
        }
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
