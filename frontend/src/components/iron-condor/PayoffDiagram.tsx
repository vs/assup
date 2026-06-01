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
    if (payoffCurve.length === 0) return { points: "", viewBox: "0 0 600 260", zeroY: 130, priceToX: () => 0, pnlToY: () => 0 };

    const prices = payoffCurve.map(p => p.price);
    const pnls = payoffCurve.map(p => p.pnl);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minPnl = Math.min(...pnls);
    const maxPnl = Math.max(...pnls);

    const w = 600;
    const h = 260;
    const pad = { top: 35, bottom: 45, left: 15, right: 15 };
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
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
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
  const profitLeft = beLowX ?? 15;
  const profitRight = beHighX ?? 585;

  // Midpoint for profit label
  const sellStrikes = strikes.filter(s => s.color === "fill-amber-600");
  const profitLabelX = sellStrikes.length > 0
    ? priceToX(sellStrikes.reduce((sum, s) => sum + s.strike, 0) / sellStrikes.length)
    : (profitLeft + profitRight) / 2;

  // Loss label positions
  const lossLabelY = Math.min(lossY - 6, 240);

  return (
    <svg viewBox={viewBox} className="w-full h-48">
      {/* Zero line */}
      <line x1="15" y1={zeroY} x2="585" y2={zeroY} stroke="currentColor" strokeWidth="1" strokeDasharray="4" className="text-border" />
      <text x="18" y={zeroY - 6} fontSize="12" className="fill-muted-foreground font-medium">$0</text>

      {/* Profit zone fill */}
      <rect x={profitLeft} y={profitY} width={profitRight - profitLeft} height={zeroY - profitY} fill="currentColor" className="text-green-500" opacity="0.1" />

      {/* Loss zone fills */}
      {beLowX != null && (
        <rect x="15" y={zeroY} width={beLowX - 15} height={lossY - zeroY} fill="currentColor" className="text-red-500" opacity="0.06" />
      )}
      {beHighX != null && (
        <rect x={beHighX} y={zeroY} width={585 - beHighX} height={lossY - zeroY} fill="currentColor" className="text-red-500" opacity="0.06" />
      )}

      {/* Payoff line */}
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600" />

      {/* Breakeven lines */}
      {beLowX != null && breakEvenLowPercent != null && (
        <>
          <line x1={beLowX} y1="10" x2={beLowX} y2="210" stroke="currentColor" strokeWidth="1" strokeDasharray="3" className="text-amber-500" />
          <text x={beLowX} y="22" fontSize="12" textAnchor="middle" className="fill-amber-700 font-bold">
            {"\u2193"}{breakEvenLowPercent.toFixed(1)}%
          </text>
        </>
      )}
      {beHighX != null && breakEvenHighPercent != null && (
        <>
          <line x1={beHighX} y1="10" x2={beHighX} y2="210" stroke="currentColor" strokeWidth="1" strokeDasharray="3" className="text-amber-500" />
          <text x={beHighX} y="22" fontSize="12" textAnchor="middle" className="fill-amber-700 font-bold">
            {"\u2191"}{breakEvenHighPercent.toFixed(1)}%
          </text>
        </>
      )}

      {/* Current price line */}
      <line x1={spotX} y1="28" x2={spotX} y2="215" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2" className="text-violet-500" />
      <text x={spotX} y="245" fontSize="12" textAnchor="middle" className="fill-violet-700 font-bold">
        {underlyingPrice.toLocaleString()}
      </text>

      {/* Strike labels */}
      {strikes.map(s => (
        <text key={s.strike} x={priceToX(s.strike)} y="245" fontSize="11" textAnchor="middle" className={s.color}>{s.label}</text>
      ))}

      {/* Max profit label */}
      <text x={profitLabelX} y={profitY + 16} fontSize="13" textAnchor="middle" className="fill-green-700 font-bold">
        +${maxProfit.toLocaleString()}
      </text>

      {/* Max loss label */}
      <text x={(profitLeft + 15) / 2} y={lossLabelY} fontSize="13" textAnchor="middle" className="fill-red-600 font-bold">
        -${maxLoss.toLocaleString()}
      </text>
    </svg>
  );
}
