import { memo } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import type { ExtendedOptionOpportunity } from "./types";

interface OpportunityRowProps {
  opportunity: ExtendedOptionOpportunity;
}

/**
 * Estimate delta for a put option based on moneyness (strike vs underlying).
 * Uses a simple linear approximation:
 * - ATM (strike = price): delta ≈ -0.50
 * - OTM (strike < price): delta approaches 0
 * - ITM (strike > price): delta approaches -1
 */
function estimatePutDelta(strike: number, underlyingPrice: number | undefined): number | null {
  if (!underlyingPrice || underlyingPrice <= 0) return null;

  // Moneyness ratio: strike / underlying
  // For puts: < 1 = OTM, = 1 = ATM, > 1 = ITM
  const moneyness = strike / underlyingPrice;

  // Simple linear approximation centered at ATM = -0.5
  // Clamp between -0.95 and -0.05
  const delta = -0.5 - (moneyness - 1) * 2;
  return Math.max(-0.95, Math.min(-0.05, delta));
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

  // Use provided delta or estimate it
  const delta = opp.delta ?? estimatePutDelta(opp.strike, opp.underlyingPrice);

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
      <TableCell className="text-right font-mono">
        {delta !== null ? delta.toFixed(2) : <span className="text-muted-foreground">N/A</span>}
      </TableCell>
      <TableCell className="text-right">{opp.premiumPercent?.toFixed(2)}%</TableCell>
      <TableCell className="text-right font-semibold">{opp.annualizedReturn?.toFixed(1)}%</TableCell>
    </TableRow>
  );
});
