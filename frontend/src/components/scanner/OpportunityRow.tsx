import { memo } from "react";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import type { ExtendedOptionOpportunity } from "./types";
import { Button } from "@/components/ui/button";
import { ExternalLinks } from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";

interface OpportunityRowProps {
  opportunity: ExtendedOptionOpportunity;
  gridCols: string;
  onSellClick?: (opportunity: ExtendedOptionOpportunity) => void;
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

/**
 * Estimate delta for a call option based on moneyness (strike vs underlying).
 * Uses a simple linear approximation:
 * - ATM (strike = price): delta ≈ 0.50
 * - OTM (strike > price): delta approaches 0
 * - ITM (strike < price): delta approaches 1
 */
function estimateCallDelta(strike: number, underlyingPrice: number | undefined): number | null {
  if (!underlyingPrice || underlyingPrice <= 0) return null;

  // Moneyness ratio: strike / underlying
  // For calls: > 1 = OTM, = 1 = ATM, < 1 = ITM
  const moneyness = strike / underlyingPrice;

  // Simple linear approximation centered at ATM = 0.5
  // Clamp between 0.05 and 0.95
  const delta = 0.5 - (moneyness - 1) * 2;
  return Math.max(0.05, Math.min(0.95, delta));
}

/**
 * Estimate delta based on option type and moneyness
 */
function estimateDelta(
  optionType: "PUT" | "CALL",
  strike: number,
  underlyingPrice: number | undefined
): number | null {
  if (optionType === "PUT") {
    return estimatePutDelta(strike, underlyingPrice);
  }
  return estimateCallDelta(strike, underlyingPrice);
}

export const OpportunityRow = memo(function OpportunityRow({
  opportunity: opp,
  gridCols,
  onSellClick,
}: OpportunityRowProps) {
  const contractName = formatDisplayName({
    symbol: opp.symbol,
    secType: "OPT",
    strike: opp.strike,
    right: opp.optionType === "PUT" ? "P" : "C",
    lastTradeDateOrContractMonth: opp.expiration,
  });

  // Use provided delta or estimate it based on option type
  const delta = opp.delta ?? estimateDelta(opp.optionType, opp.strike, opp.underlyingPrice);

  return (
    <div
      className="grid w-full items-center hover:bg-muted/30 border-b py-2"
      style={{ gridTemplateColumns: gridCols }}
    >
      <div className="pl-14 font-medium flex items-center">
        <TickerHoverCard symbol={opp.symbol}>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${opp.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary hover:underline"
          >
            {contractName}
          </a>
        </TickerHoverCard>
        <ExternalLinks symbol={opp.symbol} />
      </div>
      <div className="text-right font-mono pr-2">
        {formatCurrency(opp.strike, { maximumFractionDigits: 2 })}
      </div>
      <div className="text-right font-mono pr-2">
        {opp.underlyingPrice
          ? formatCurrency(opp.underlyingPrice, { maximumFractionDigits: 2 })
          : <span className="text-muted-foreground">N/A</span>
        }
      </div>
      <div className="text-right font-mono pr-2">
        {formatCurrency(opp.bid, { maximumFractionDigits: 2 })}
      </div>
      <div className="text-right font-mono pr-2">
        {formatCurrency(opp.ask, { maximumFractionDigits: 2 })}
      </div>
      <div className="text-right font-mono pr-2">
        {formatCurrency(opp.midPrice, { maximumFractionDigits: 2 })}
      </div>
      <div className="text-right font-mono pr-2">
        {delta !== null ? delta.toFixed(2) : <span className="text-muted-foreground">N/A</span>}
      </div>
      <div className="text-right pr-2">{opp.premiumPercent?.toFixed(2)}%</div>
      <div className="text-right font-semibold pr-2">{opp.annualizedReturn?.toFixed(1)}%</div>
      <div className="text-right pr-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSellClick?.(opp)}
        >
          Sell
        </Button>
      </div>
    </div>
  );
});
