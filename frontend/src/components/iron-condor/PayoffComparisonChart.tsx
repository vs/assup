/**
 * SVG payoff comparison chart that overlays two P&L curves (before and after hedging).
 * The "before" curve is rendered as a dashed red polyline; "after" as a solid blue polyline.
 * Interactive cursor shows a tooltip with P&L for both curves at the hovered price.
 */

import { useMemo, useState, useCallback, useRef } from "react";

interface CurvePoint {
  price: number;
  pnl: number;
}

interface StrikeLabel {
  strike: number;
  label: string;
}

interface PayoffComparisonChartProps {
  beforeCurve: CurvePoint[];
  afterCurve: CurvePoint[];
  underlyingPrice: number;
  strikes: StrikeLabel[];
}

interface CursorState {
  svgX: number;
  price: number;
  beforePnl: number;
  afterPnl: number;
}

const W = 800;
const H = 300;
const pad = { top: 30, bottom: 45, left: 65, right: 20 };

function interpolatePnl(curve: CurvePoint[], price: number): number {
  if (curve.length === 0) return 0;
  if (price <= curve[0].price) return curve[0].pnl;
  if (price >= curve[curve.length - 1].price) return curve[curve.length - 1].pnl;

  for (let i = 0; i < curve.length - 1; i++) {
    if (price >= curve[i].price && price <= curve[i + 1].price) {
      const t = (price - curve[i].price) / (curve[i + 1].price - curve[i].price);
      return curve[i].pnl + t * (curve[i + 1].pnl - curve[i].pnl);
    }
  }
  return 0;
}

export function PayoffComparisonChart({
  beforeCurve,
  afterCurve,
  underlyingPrice,
  strikes,
}: PayoffComparisonChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<CursorState | null>(null);

  const { beforePoints, afterPoints, zeroY, priceToX, pnlToY, minPrice, maxPrice, maxProfitY, maxLossY, maxPnlVal, minPnlVal } = useMemo(() => {
    const empty = {
      beforePoints: "",
      afterPoints: "",
      zeroY: H / 2,
      priceToX: () => 0,
      pnlToY: () => 0,
      minPrice: 0,
      maxPrice: 0,
      maxProfitY: pad.top,
      maxLossY: H - pad.bottom,
      maxPnlVal: 0,
      minPnlVal: 0,
    };

    if (beforeCurve.length === 0 || afterCurve.length === 0) return empty;

    const allPrices = [...beforeCurve.map(p => p.price), ...afterCurve.map(p => p.price)];
    const allPnls = [...beforeCurve.map(p => p.pnl), ...afterCurve.map(p => p.pnl)];

    const pMin = Math.min(...allPrices);
    const pMax = Math.max(...allPrices);
    const pnlMin = Math.min(...allPnls);
    const pnlMax = Math.max(...allPnls);

    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const toX = (price: number) => pad.left + ((price - pMin) / (pMax - pMin)) * plotW;
    const toY = (pnl: number) => pad.top + plotH - ((pnl - pnlMin) / (pnlMax - pnlMin)) * plotH;

    const bPts = beforeCurve.map(p => `${toX(p.price)},${toY(p.pnl)}`).join(" ");
    const aPts = afterCurve.map(p => `${toX(p.price)},${toY(p.pnl)}`).join(" ");
    const zy = toY(0);

    return {
      beforePoints: bPts,
      afterPoints: aPts,
      zeroY: zy,
      priceToX: toX,
      pnlToY: toY,
      minPrice: pMin,
      maxPrice: pMax,
      maxProfitY: toY(pnlMax),
      maxLossY: toY(pnlMin),
      maxPnlVal: pnlMax,
      minPnlVal: pnlMin,
    };
  }, [beforeCurve, afterCurve]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg || beforeCurve.length === 0 || afterCurve.length === 0) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgX = (e.clientX - ctm.e) / ctm.a;
    const plotW = W - pad.left - pad.right;
    const price = minPrice + ((svgX - pad.left) / plotW) * (maxPrice - minPrice);
    if (price < minPrice || price > maxPrice) {
      setCursor(null);
      return;
    }
    setCursor({
      svgX,
      price,
      beforePnl: interpolatePnl(beforeCurve, price),
      afterPnl: interpolatePnl(afterCurve, price),
    });
  }, [beforeCurve, afterCurve, minPrice, maxPrice]);

  const handleMouseLeave = useCallback(() => setCursor(null), []);

  const spotX = priceToX(underlyingPrice);

  // Filter strike labels that overlap with each other or the underlying price label.
  // Underlying price has priority — skip any strike label within MIN_GAP pixels of it.
  const MIN_GAP = 45;
  const visibleStrikes = useMemo(() => {
    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    const result: StrikeLabel[] = [];
    for (const s of sorted) {
      const sx = priceToX(s.strike);
      // Too close to underlying price label?
      if (Math.abs(sx - spotX) < MIN_GAP) continue;
      // Too close to previously accepted strike label?
      if (result.length > 0 && Math.abs(sx - priceToX(result[result.length - 1].strike)) < MIN_GAP) continue;
      result.push(s);
    }
    return result;
  }, [strikes, priceToX, spotX]);

  if (beforeCurve.length === 0 || afterCurve.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading payoff data...
      </div>
    );
  }

  const cursorBeforeY = cursor ? pnlToY(cursor.beforePnl) : 0;
  const cursorAfterY = cursor ? pnlToY(cursor.afterPnl) : 0;

  // Tooltip placement: flip to left side if cursor is in the right half
  const tooltipX = cursor ? (cursor.svgX < W / 2 ? cursor.svgX + 12 : cursor.svgX - 162) : 0;
  const tooltipY = cursor ? Math.max(Math.min(cursorBeforeY, cursorAfterY) - 8, pad.top) : 0;

  return (
    <div className="relative cursor-crosshair">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "280px" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Y-axis labels */}
        <text x={pad.left - 8} y={maxProfitY + 4} fontSize="11" textAnchor="end" className="fill-green-600 font-medium">
          +${maxPnlVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>
        <text x={pad.left - 8} y={zeroY + 4} fontSize="11" textAnchor="end" className="fill-muted-foreground">
          $0
        </text>
        <text x={pad.left - 8} y={maxLossY + 4} fontSize="11" textAnchor="end" className="fill-red-600 font-medium">
          ${minPnlVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>

        {/* Zero line */}
        <line x1={pad.left} y1={zeroY} x2={W - pad.right} y2={zeroY} stroke="currentColor" strokeWidth="1" strokeDasharray="4" className="text-border" />

        {/* Strike guide lines */}
        {strikes.map(s => {
          const sx = priceToX(s.strike);
          return (
            <line key={s.strike} x1={sx} y1={pad.top} x2={sx} y2={H - pad.bottom} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3,4" className="text-muted-foreground/30" />
          );
        })}

        {/* Before curve: dashed red */}
        <polyline points={beforePoints} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="6,4" className="text-red-400" />

        {/* After curve: solid blue */}
        <polyline points={afterPoints} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600" />

        {/* Current price vertical line */}
        <line x1={spotX} y1={pad.top} x2={spotX} y2={H - pad.bottom} stroke="currentColor" strokeWidth="1.5" strokeDasharray="2" className="text-violet-500" />
        <text x={spotX} y={H - pad.bottom + 14} fontSize="11" textAnchor="middle" className="fill-violet-700 font-bold">
          {underlyingPrice.toLocaleString()}
        </text>

        {/* Strike labels (filtered to avoid overlap) */}
        {visibleStrikes.map(s => (
          <text key={s.strike} x={priceToX(s.strike)} y={H - pad.bottom + 28} fontSize="10" textAnchor="middle" className="fill-muted-foreground">
            {s.label}
          </text>
        ))}

        {/* Legend: top-right corner */}
        <g transform={`translate(${W - pad.right - 130}, ${pad.top})`}>
          <rect x="0" y="0" width="130" height="44" rx="4" fill="currentColor" className="text-background" opacity="0.85" />
          {/* Before legend */}
          <line x1="8" y1="14" x2="30" y2="14" stroke="currentColor" strokeWidth="2" strokeDasharray="6,4" className="text-red-400" />
          <text x="36" y="18" fontSize="11" className="fill-red-400 font-medium">Before hedge</text>
          {/* After legend */}
          <line x1="8" y1="32" x2="30" y2="32" stroke="currentColor" strokeWidth="2.5" className="text-blue-600" />
          <text x="36" y="36" fontSize="11" className="fill-blue-600 font-medium">After hedge</text>
        </g>

        {/* Interactive cursor */}
        {cursor && (
          <>
            {/* Vertical crosshair */}
            <line
              x1={cursor.svgX} y1={pad.top} x2={cursor.svgX} y2={H - pad.bottom}
              stroke="currentColor" strokeWidth="1" className="text-foreground/40"
            />
            {/* Dot on before curve */}
            <circle cx={cursor.svgX} cy={cursorBeforeY} r="4" fill="currentColor" className="text-red-400" />
            {/* Dot on after curve */}
            <circle cx={cursor.svgX} cy={cursorAfterY} r="4" fill="currentColor" className="text-blue-600" />
            {/* Tooltip */}
            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
              <rect x="0" y="0" width="150" height="52" rx="4" fill="currentColor" className="text-foreground" opacity="0.92" />
              <text x="8" y="14" fontSize="11" className="fill-background font-bold">
                {cursor.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </text>
              {/* Before P&L row */}
              <text x="8" y="30" fontSize="10" className="fill-red-300">Before:</text>
              <text x="52" y="30" fontSize="10" className={`font-bold ${cursor.beforePnl >= 0 ? "fill-green-300" : "fill-red-300"}`}>
                {cursor.beforePnl >= 0 ? "+" : ""}{cursor.beforePnl < 0 ? "-" : ""}${Math.abs(cursor.beforePnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </text>
              {/* After P&L row */}
              <text x="8" y="46" fontSize="10" className="fill-blue-300">After:</text>
              <text x="52" y="46" fontSize="10" className={`font-bold ${cursor.afterPnl >= 0 ? "fill-green-300" : "fill-red-300"}`}>
                {cursor.afterPnl >= 0 ? "+" : ""}{cursor.afterPnl < 0 ? "-" : ""}${Math.abs(cursor.afterPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </text>
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
