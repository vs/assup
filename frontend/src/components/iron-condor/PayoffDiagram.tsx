/**
 * Interactive SVG payoff diagram for spread analysis.
 * Renders P&L curve with breakeven annotations and cursor crosshair.
 * Hover to see price and P&L at any point on the curve.
 */

import { useMemo, useState, useCallback, useRef } from "react";

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
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<{ svgX: number; price: number; pnl: number } | null>(null);

  const W = 800;
  const H = 340;
  const pad = { top: 35, bottom: 50, left: 60, right: 20 };

  const { points, zeroY, priceToX, pnlToY, minPrice, maxPrice } = useMemo(() => {
    if (payoffCurve.length === 0) return { points: "", zeroY: 170, priceToX: () => 0, pnlToY: () => 0, minPrice: 0, maxPrice: 0 };

    const prices = payoffCurve.map(p => p.price);
    const pnls = payoffCurve.map(p => p.pnl);
    const pMin = Math.min(...prices);
    const pMax = Math.max(...prices);
    const pnlMin = Math.min(...pnls);
    const pnlMax = Math.max(...pnls);

    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const toX = (price: number) => pad.left + ((price - pMin) / (pMax - pMin)) * plotW;
    const toY = (pnl: number) => pad.top + plotH - ((pnl - pnlMin) / (pnlMax - pnlMin)) * plotH;

    const pts = payoffCurve.map(p => `${toX(p.price)},${toY(p.pnl)}`).join(" ");
    const zy = toY(0);

    return { points: pts, zeroY: zy, priceToX: toX, pnlToY: toY, minPrice: pMin, maxPrice: pMax };
  }, [payoffCurve]);

  // Interpolate P&L from payoff curve at a given price
  const interpolatePnl = useCallback((price: number): number => {
    if (payoffCurve.length === 0) return 0;
    if (price <= payoffCurve[0].price) return payoffCurve[0].pnl;
    if (price >= payoffCurve[payoffCurve.length - 1].price) return payoffCurve[payoffCurve.length - 1].pnl;

    for (let i = 0; i < payoffCurve.length - 1; i++) {
      if (price >= payoffCurve[i].price && price <= payoffCurve[i + 1].price) {
        const t = (price - payoffCurve[i].price) / (payoffCurve[i + 1].price - payoffCurve[i].price);
        return payoffCurve[i].pnl + t * (payoffCurve[i + 1].pnl - payoffCurve[i].pnl);
      }
    }
    return 0;
  }, [payoffCurve]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg || payoffCurve.length === 0) return;
    // Use SVG coordinate transform for pixel-perfect mapping
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgX = (e.clientX - ctm.e) / ctm.a;
    const plotW = W - pad.left - pad.right;
    const price = minPrice + ((svgX - pad.left) / plotW) * (maxPrice - minPrice);
    if (price < minPrice || price > maxPrice) {
      setCursor(null);
      return;
    }
    const pnl = interpolatePnl(price);
    setCursor({ svgX, price, pnl });
  }, [payoffCurve, minPrice, maxPrice, interpolatePnl]);

  const handleMouseLeave = useCallback(() => setCursor(null), []);

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
  const profitLeft = beLowX ?? pad.left;
  const profitRight = beHighX ?? (W - pad.right);

  // Midpoint for profit label
  const sellStrikes = strikes.filter(s => s.color === "fill-amber-600");
  const profitLabelX = sellStrikes.length > 0
    ? priceToX(sellStrikes.reduce((sum, s) => sum + s.strike, 0) / sellStrikes.length)
    : (profitLeft + profitRight) / 2;

  // Loss label positions
  const lossLabelY = Math.min(lossY - 6, H - pad.bottom - 10);

  // Cursor Y position on the curve
  const cursorY = cursor ? pnlToY(cursor.pnl) : 0;

  return (
    <div className="relative cursor-crosshair">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "320px" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Y-axis labels */}
        <text x={pad.left - 8} y={profitY + 4} fontSize="11" textAnchor="end" className="fill-green-600 font-medium">
          +${maxProfit.toLocaleString()}
        </text>
        <text x={pad.left - 8} y={zeroY + 4} fontSize="11" textAnchor="end" className="fill-muted-foreground">
          $0
        </text>
        <text x={pad.left - 8} y={lossY + 4} fontSize="11" textAnchor="end" className="fill-red-600 font-medium">
          -${maxLoss.toLocaleString()}
        </text>

        {/* Grid lines */}
        <line x1={pad.left} y1={profitY} x2={W - pad.right} y2={profitY} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3" className="text-green-300" />
        <line x1={pad.left} y1={lossY} x2={W - pad.right} y2={lossY} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3" className="text-red-300" />

        {/* Zero line */}
        <line x1={pad.left} y1={zeroY} x2={W - pad.right} y2={zeroY} stroke="currentColor" strokeWidth="1" strokeDasharray="4" className="text-border" />

        {/* Profit zone fill */}
        <rect x={profitLeft} y={profitY} width={profitRight - profitLeft} height={zeroY - profitY} fill="currentColor" className="text-green-500" opacity="0.1" />

        {/* Loss zone fills */}
        {beLowX != null && (
          <rect x={pad.left} y={zeroY} width={beLowX - pad.left} height={lossY - zeroY} fill="currentColor" className="text-red-500" opacity="0.06" />
        )}
        {beHighX != null && (
          <rect x={beHighX} y={zeroY} width={W - pad.right - beHighX} height={lossY - zeroY} fill="currentColor" className="text-red-500" opacity="0.06" />
        )}

        {/* Payoff line */}
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600" />

        {/* Breakeven lines */}
        {beLowX != null && breakEvenLowPercent != null && (
          <>
            <line x1={beLowX} y1={pad.top} x2={beLowX} y2={H - pad.bottom} stroke="currentColor" strokeWidth="1" strokeDasharray="3" className="text-amber-500" />
            <text x={beLowX} y={pad.top - 6} fontSize="12" textAnchor="middle" className="fill-amber-700 font-bold">
              {"\u2193"}{breakEvenLowPercent.toFixed(1)}%
            </text>
          </>
        )}
        {beHighX != null && breakEvenHighPercent != null && (
          <>
            <line x1={beHighX} y1={pad.top} x2={beHighX} y2={H - pad.bottom} stroke="currentColor" strokeWidth="1" strokeDasharray="3" className="text-amber-500" />
            <text x={beHighX} y={pad.top - 6} fontSize="12" textAnchor="middle" className="fill-amber-700 font-bold">
              {"\u2191"}{breakEvenHighPercent.toFixed(1)}%
            </text>
          </>
        )}

        {/* Current price line */}
        <line x1={spotX} y1={pad.top} x2={spotX} y2={H - pad.bottom} stroke="currentColor" strokeWidth="1.5" strokeDasharray="2" className="text-violet-500" />
        <text x={spotX} y={H - pad.bottom + 16} fontSize="12" textAnchor="middle" className="fill-violet-700 font-bold">
          {underlyingPrice.toLocaleString()}
        </text>

        {/* Strike labels */}
        {strikes.map(s => (
          <text key={s.strike} x={priceToX(s.strike)} y={H - pad.bottom + 30} fontSize="11" textAnchor="middle" className={s.color}>{s.label}</text>
        ))}

        {/* Max profit label */}
        <text x={profitLabelX} y={profitY + 16} fontSize="13" textAnchor="middle" className="fill-green-700 font-bold">
          +${maxProfit.toLocaleString()}
        </text>

        {/* Max loss label */}
        <text x={(profitLeft + pad.left) / 2} y={lossLabelY} fontSize="13" textAnchor="middle" className="fill-red-600 font-bold">
          -${maxLoss.toLocaleString()}
        </text>

        {/* Interactive cursor */}
        {cursor && (
          <>
            {/* Vertical crosshair */}
            <line
              x1={cursor.svgX} y1={pad.top} x2={cursor.svgX} y2={H - pad.bottom}
              stroke="currentColor" strokeWidth="1" className="text-foreground/40"
            />
            {/* Horizontal crosshair at P&L level */}
            <line
              x1={pad.left} y1={cursorY} x2={W - pad.right} y2={cursorY}
              stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" className="text-foreground/30"
            />
            {/* Dot on the curve */}
            <circle
              cx={cursor.svgX} cy={cursorY} r="4"
              fill="currentColor"
              className={cursor.pnl >= 0 ? "text-green-600" : "text-red-600"}
            />
            {/* Price/P&L tooltip */}
            <g transform={`translate(${cursor.svgX < W / 2 ? cursor.svgX + 10 : cursor.svgX - 150}, ${Math.max(cursorY - 36, pad.top)})`}>
              <rect x="0" y="0" width="140" height="32" rx="4" fill="currentColor" className="text-background" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="0" width="140" height="32" rx="4" fill="currentColor" className="text-foreground" opacity="0.9" />
              <text x="8" y="14" fontSize="11" className="fill-background font-medium">
                {cursor.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </text>
              <text x="8" y="26" fontSize="11" className={`font-bold ${cursor.pnl >= 0 ? "fill-green-300" : "fill-red-300"}`}>
                {cursor.pnl >= 0 ? "+" : ""}{cursor.pnl < 0 ? "-" : ""}${Math.abs(cursor.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </text>
              <text x="72" y="14" fontSize="10" className="fill-background/70">
                {((cursor.price / underlyingPrice - 1) * 100).toFixed(1)}%
              </text>
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
