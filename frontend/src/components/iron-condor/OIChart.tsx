import { useMemo, useState } from "react";
import type { GexStrikeData, GexKeyLevels } from "@assup/shared";
import { Callout, SpotMarker } from "./GexChartParts";
import {
  barWidth, clamp, fmtPrice, nearestBy, niceStep, ticksIn, useContainerWidth,
} from "./gexChartHelpers";

const MARGIN = { top: 34, right: 24, bottom: 46, left: 74 };
/** Same ±5% window as the dealer gamma chart so both share one strike axis. */
const RANGE_PCT = 0.05;

interface OIChartProps {
  strikes: GexStrikeData[];
  spot: number;
  levels: GexKeyLevels;
  /** What the open interest covers, e.g. "expiry 2026-10-23". */
  scope: string;
}

function fmtOI(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Number((abs / 1_000).toFixed(1))}k`;
  return String(abs);
}

/** Marker for a wall that lies outside the visible strike window. */
function EdgeLabel({ x, y, anchor, color, text }: { x: number; y: number; anchor: "start" | "end"; color: string; text: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={color} fontSize={13} fontWeight={600}
      stroke="var(--gx-plot)" strokeWidth={4} paintOrder="stroke">
      {text}
    </text>
  );
}

/**
 * Open interest by strike: calls above the axis, puts mirrored below, on a
 * price-scaled axis spanning ±5% of spot. Walls outside it get an edge marker.
 */
export function OIChart({ strikes, spot, levels, scope }: OIChartProps) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const height = Math.round(clamp(width * 0.3, 300, 420));

  const layout = useMemo(() => {
    if (width === 0) return null;
    const xMin = spot * (1 - RANGE_PCT);
    const xMax = spot * (1 + RANGE_PCT);
    const visible = strikes.filter((s) => s.strike >= xMin && s.strike <= xMax);
    if (visible.length === 0) return null;

    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const x = (v: number) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const xInv = (px: number) => xMin + ((px - MARGIN.left) / plotW) * (xMax - xMin);

    const maxCall = Math.max(1, ...visible.map((s) => s.callOI)) * 1.1;
    const maxPut = Math.max(1, ...visible.map((s) => s.putOI)) * 1.1;
    const y = (v: number) => MARGIN.top + ((maxCall - v) / (maxCall + maxPut)) * plotH;

    const yStep = niceStep(maxCall + maxPut, Math.max(4, Math.round(plotH / 60)));
    return {
      visible, plotW, plotH, xMin, xMax, x, xInv, y,
      y0: y(0),
      yTicks: ticksIn(-maxPut, maxCall, yStep),
      xTicks: ticksIn(xMin, xMax, niceStep(xMax - xMin, Math.max(4, Math.round(plotW / 110)))),
      barW: barWidth(visible.map((s) => s.strike), xMin, xMax, plotW),
    };
  }, [strikes, spot, width, height]);

  const hovered = hoverX !== null && layout
    ? nearestBy(layout.visible, (s) => s.strike, layout.xInv(hoverX))
    : null;

  const putWall = levels.putWall;
  const callWall = levels.callWall;

  return (
    <div className="gex-chart min-w-0 rounded-lg border bg-[var(--gx-panel)] px-5 pt-4 pb-3 text-[var(--gx-text)]">
      <div className="mb-1 text-base font-semibold tracking-tight">Open interest by strike</div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span className="text-xs text-[var(--gx-muted)]">{scope}</span>
        <span>put wall <span className="font-semibold text-[var(--gx-neg)]">{fmtPrice(putWall.strike)}</span> <span className="text-[var(--gx-muted)]">({fmtOI(putWall.oi)})</span></span>
        <span>call wall <span className="font-semibold text-[var(--gx-pos)]">{fmtPrice(callWall.strike)}</span> <span className="text-[var(--gx-muted)]">({fmtOI(callWall.oi)})</span></span>
      </div>

      <div ref={containerRef} className="relative" style={{ height }}>
        {layout && (
          <svg
            width={width}
            height={height}
            className="absolute inset-0 block select-none"
            fontFamily="inherit"
            onMouseMove={(e) => {
              const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
              setHoverX(px >= MARGIN.left && px <= MARGIN.left + layout.plotW ? px : null);
            }}
            onMouseLeave={() => setHoverX(null)}
          >
            <rect x={MARGIN.left} y={MARGIN.top} width={layout.plotW} height={layout.plotH} fill="var(--gx-plot)" />

            {layout.yTicks.map((t) => (
              <line key={`gy${t}`} x1={MARGIN.left} x2={MARGIN.left + layout.plotW} y1={layout.y(t)} y2={layout.y(t)} stroke="var(--gx-grid)" />
            ))}
            {layout.xTicks.map((t) => (
              <line key={`gx${t}`} x1={layout.x(t)} x2={layout.x(t)} y1={MARGIN.top} y2={MARGIN.top + layout.plotH} stroke="var(--gx-grid)" />
            ))}

            {layout.visible.map((s) => {
              const cx = layout.x(s.strike) - layout.barW / 2;
              return (
                <g key={s.strike}>
                  {s.callOI > 0 && (
                    <rect x={cx} y={layout.y(s.callOI)} width={layout.barW} height={layout.y0 - layout.y(s.callOI)} fill="var(--gx-pos)" />
                  )}
                  {s.putOI > 0 && (
                    <rect x={cx} y={layout.y0} width={layout.barW} height={layout.y(-s.putOI) - layout.y0} fill="var(--gx-neg)" />
                  )}
                </g>
              );
            })}
            <line x1={MARGIN.left} x2={MARGIN.left + layout.plotW} y1={layout.y0} y2={layout.y0} stroke="var(--gx-axis)" />

            <SpotMarker x={layout.x(spot)} top={MARGIN.top} bottom={MARGIN.top + layout.plotH} spot={spot} />

            {putWall.strike >= layout.xMin ? (
              <Callout
                x={layout.x(putWall.strike)}
                y={layout.y(-putWall.oi)}
                labelX={clamp(layout.x(putWall.strike) - 90, MARGIN.left + 50, MARGIN.left + layout.plotW - 50)}
                labelY={clamp(layout.y(-putWall.oi) - 60, MARGIN.top + 24, MARGIN.top + layout.plotH - 24)}
                color="var(--gx-neg)"
                lines={["put wall", fmtPrice(putWall.strike)]}
                gap={4}
              />
            ) : (
              <EdgeLabel x={MARGIN.left + 8} y={MARGIN.top + layout.plotH - 12} anchor="start" color="var(--gx-neg)"
                text={`◂ put wall ${fmtPrice(putWall.strike)} (${fmtOI(putWall.oi)})`} />
            )}
            {callWall.strike <= layout.xMax ? (
              <Callout
                x={layout.x(callWall.strike)}
                y={layout.y(callWall.oi)}
                labelX={clamp(layout.x(callWall.strike) + 90, MARGIN.left + 50, MARGIN.left + layout.plotW - 50)}
                labelY={clamp(layout.y(callWall.oi) + 60, MARGIN.top + 24, MARGIN.top + layout.plotH - 24)}
                color="var(--gx-pos)"
                lines={["call wall", fmtPrice(callWall.strike)]}
                gap={4}
              />
            ) : (
              <EdgeLabel x={MARGIN.left + layout.plotW - 8} y={MARGIN.top + 20} anchor="end" color="var(--gx-pos)"
                text={`call wall ${fmtPrice(callWall.strike)} (${fmtOI(callWall.oi)}) ▸`} />
            )}

            {hovered && (
              <line x1={hoverX!} x2={hoverX!} y1={MARGIN.top} y2={MARGIN.top + layout.plotH} stroke="var(--gx-muted)" strokeOpacity={0.6} />
            )}

            {layout.yTicks.map((t) => (
              <text key={`yt${t}`} x={MARGIN.left - 8} y={layout.y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--gx-muted)">
                {fmtOI(t)}
              </text>
            ))}
            {layout.xTicks.map((t) => (
              <text key={`xt${t}`} x={layout.x(t)} y={MARGIN.top + layout.plotH + 17} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">
                {fmtPrice(t)}
              </text>
            ))}
            <text x={MARGIN.left + layout.plotW / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">strike</text>
            <text transform={`translate(14 ${MARGIN.top + layout.plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">
              open interest, contracts (calls ↑ puts ↓)
            </text>
          </svg>
        )}

        {layout && (
          <div
            className="pointer-events-none absolute space-y-1 rounded border border-[var(--gx-axis)] bg-[var(--gx-panel)]/85 px-2.5 py-2 text-xs"
            style={{ left: MARGIN.left + 12, top: MARGIN.top + 12 }}
          >
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[var(--gx-pos)]" />call OI</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[var(--gx-neg)]" />put OI</div>
          </div>
        )}

        {layout && hovered && (
          <div
            className="pointer-events-none absolute z-10 min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{
              top: MARGIN.top + 8,
              ...(hoverX! > width / 2 ? { right: width - hoverX! + 12 } : { left: hoverX! + 12 }),
            }}
          >
            <div className="mb-1 font-medium">Strike {fmtPrice(hovered.strike)}</div>
            <div>Call OI: <span className="text-emerald-500">{hovered.callOI.toLocaleString()}</span> · vol {hovered.callVolume.toLocaleString()}</div>
            <div>Put OI: <span className="text-rose-500">{hovered.putOI.toLocaleString()}</span> · vol {hovered.putVolume.toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
