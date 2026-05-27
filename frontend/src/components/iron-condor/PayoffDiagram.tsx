/**
 * SVG payoff diagram for spread analysis.
 * Renders P&L curve with breakeven annotations showing % distance from current price.
 */

import { useMemo } from "react";

interface PayoffDiagramProps {
  payoffCurve: Array<{ price: number; pnl: number }>;
  underlyingPrice: number;
  breakEvenLow: number | null;
  breakEvenHigh: number | null;
  breakEvenLowPercent: number | null;
  breakEvenHighPercent: number | null;
  maxProfit: number;
  maxLoss: number;
  strikes: Array<{ strike: number; label: string; color: string }>;
}

export function PayoffDiagram({
  payoffCurve,
  underlyingPrice,
  breakEvenLow,
  breakEvenHigh,
  breakEvenLowPercent,
  breakEvenHighPercent,
  maxProfit,
  maxLoss,
  strikes,
}: PayoffDiagramProps) {
  const { points, viewBox, zeroY, priceToX, pnlToY } = useMemo(() => {
    if (payoffCurve.length === 0) return { points: "", viewBox: "0 0 600 200", zeroY: 100, priceToX: () => 0, pnlToY: () => 0 };

    const prices = payoffCurve.map(p => p.price);
    const pnls = payoffCurve.map(p => p.pnl);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minPnl = Math.min(...pnls);
    const maxPnl = Math.max(...pnls);

    const w = 600;
    const h = 200;
    const pad = { top: 25, bottom: 30, left: 10, right: 10 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const toX = (price: number) => pad.left + ((price - minPrice) / (maxPrice - minPrice)) * plotW;
    const toY = (pnl: number) => pad.top + plotH - ((pnl - minPnl) / (maxPnl - minPnl)) * plotH;

    const pts = payoffCurve.map(p => `${toX(p.price)},${toY(p.pnl)}`).join(" ");
    const zy = toY(0);

    return { points: pts, viewBox: `0 0 ${w} ${h}`, zeroY: zy, priceToX: toX, pnlToY: toY };
  }, [payoffCurve]);

  if (payoffCurve.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Select all legs to see payoff diagram
      </div>
    );
  }

  const beLowX = breakEvenLow != null ? priceToX(breakEvenLow) : null;
  const beHighX = breakEvenHigh != null ? priceToX(breakEvenHigh) : null;
  const spotX = priceToX(underlyingPrice);
  const profitY = pnlToY(maxProfit);
  const lossY = pnlToY(-maxLoss);

  // Profit zone boundaries
  const profitLeft = beLowX ?? 10;
  const profitRight = beHighX ?? 590;

  // Midpoint for profit label
  const sellStrikes = strikes.filter(s => s.color === "fill-amber-600");
  const profitLabelX = sellStrikes.length > 0
    ? priceToX(sellStrikes.reduce((sum, s) => sum + s.strike, 0) / sellStrikes.length)
    : (profitLeft + profitRight) / 2;

  return (
    <svg viewBox={viewBox} className="w-full h-40">
      {/* Zero line */}
      <line x1="10" y1={zeroY} x2="590" y2={zeroY} stroke="currentColor" strokeWidth="1" strokeDasharray="4" className="text-border" />
      <text x="14" y={zeroY - 4} fontSize="9" className="fill-muted-foreground">$0</text>

      {/* Profit zone fill */}
      <rect x={profitLeft} y={profitY} width={profitRight - profitLeft} height={zeroY - profitY} fill="currentColor" className="text-green-500" opacity="0.1" />

      {/* Loss zone fills — conditional */}
      {beLowX != null && (
        <rect x="10" y={zeroY} width={beLowX - 10} height={lossY - zeroY} fill="currentColor" className="text-red-500" opacity="0.06" />
      )}
      {beHighX != null && (
        <rect x={beHighX} y={zeroY} width={590 - beHighX} height={lossY - zeroY} fill="currentColor" className="text-red-500" opacity="0.06" />
      )}

      {/* Payoff line */}
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600" />

      {/* Breakeven lines — conditional */}
      {beLowX != null && breakEvenLowPercent != null && (
        <>
          <line x1={beLowX} y1="5" x2={beLowX} y2="170" stroke="currentColor" strokeWidth="1" strokeDasharray="3" className="text-amber-500" />
          <text x={beLowX} y="14" fontSize="8" textAnchor="middle" className="fill-amber-600 font-medium">
            {"\u2193"}{breakEvenLowPercent.toFixed(1)}%
          </text>
        </>
      )}
      {beHighX != null && breakEvenHighPercent != null && (
        <>
          <line x1={beHighX} y1="5" x2={beHighX} y2="170" stroke="currentColor" strokeWidth="1" strokeDasharray="3" className="text-amber-500" />
          <text x={beHighX} y="14" fontSize="8" textAnchor="middle" className="fill-amber-600 font-medium">
            {"\u2191"}{breakEvenHighPercent.toFixed(1)}%
          </text>
        </>
      )}

      {/* Current price line */}
      <line x1={spotX} y1="20" x2={spotX} y2="170" stroke="currentColor" strokeWidth="1" strokeDasharray="2" className="text-violet-500" />
      <text x={spotX} y="190" fontSize="8" textAnchor="middle" className="fill-violet-600">
        {underlyingPrice.toLocaleString()}
      </text>

      {/* Strike labels */}
      {strikes.map(s => (
        <text key={s.strike} x={priceToX(s.strike)} y="190" fontSize="7" textAnchor="middle" className={s.color}>{s.label}</text>
      ))}

      {/* P&L label */}
      <text x={profitLabelX} y={profitY + 14} fontSize="9" textAnchor="middle" className="fill-green-600 font-semibold">
        +${maxProfit.toLocaleString()}
      </text>
    </svg>
  );
}
