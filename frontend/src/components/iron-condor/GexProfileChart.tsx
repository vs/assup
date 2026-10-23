import { useMemo, useState } from "react";
import type { GexProfileResponse, GexProfileStrike, GexProfilePoint } from "@assup/shared";
import { Callout, SpotMarker } from "./GexChartParts";
import {
  MINUS, barWidth, clamp, fmtPrice, nearestBy, niceStep, ticksIn, useContainerWidth,
} from "./gexChartHelpers";

const MARGIN = { top: 34, right: 70, bottom: 46, left: 74 };

/**
 * Domains for two value axes that share one zero baseline.
 * Each extent is [most negative (<= 0), most positive (>= 0)].
 */
function alignedDomains(a: [number, number], b: [number, number]): [[number, number], [number, number]] {
  const share = ([lo, hi]: [number, number]) => (hi - lo === 0 ? 0.5 : hi / (hi - lo));
  const z = clamp((share(a) + share(b)) / 2, 0.15, 0.85); // fraction of height above zero
  const fit = ([lo, hi]: [number, number]): [number, number] => {
    const unit = Math.max(hi / z, -lo / (1 - z)) || 1;
    return [-(1 - z) * unit, z * unit];
  };
  return [fit(a), fit(b)];
}

function extent(values: number[], pad = 1.08): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo * pad, hi * pad];
}

function signed(v: number, body: string): string {
  return `${v < 0 ? MINUS : "+"}${body}`;
}

function fmtBillions(v: number): string {
  return signed(v, `$${(Math.abs(v) / 1e9).toFixed(1)}B`);
}

function fmtMillions(v: number): string {
  return signed(v, `$${Math.round(Math.abs(v) / 1e6).toLocaleString()}M`);
}

function fmtTick(v: number, unit: number): string {
  const n = v / unit;
  return `${n < 0 ? MINUS : ""}${Math.abs(n).toLocaleString()}`;
}

function fmtAsOf(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

interface GexProfileChartProps {
  data: GexProfileResponse;
}

/**
 * Dealer gamma by strike (bars, left axis) overlaid with the total net GEX
 * curve if spot moved to each price (lines, right axis), all expiries vs ex-0DTE.
 */
export function GexProfileChart({ data }: GexProfileChartProps) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const height = Math.round(clamp(width * 0.46, 380, 560));
  const hasZeroDte = data.zeroDteExpiration !== null;

  const layout = useMemo(() => {
    if (width === 0 || data.profile.length < 2) return null;
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const xMin = data.profile[0].price;
    const xMax = data.profile[data.profile.length - 1].price;
    const x = (v: number) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const xInv = (px: number) => xMin + ((px - MARGIN.left) / plotW) * (xMax - xMin);

    const barExtent = extent(data.strikes.flatMap((s) => [s.netGEX, s.zeroDteGEX]));
    const lineExtent = extent(data.profile.flatMap((p) => [p.netGEX, p.netGEXExZeroDte]));
    const [leftDom, rightDom] = alignedDomains(barExtent, lineExtent);
    const scaleY = ([lo, hi]: [number, number]) => (v: number) => MARGIN.top + ((hi - v) / (hi - lo)) * plotH;
    const yL = scaleY(leftDom);
    const yR = scaleY(rightDom);

    const tickCount = Math.max(4, Math.round(plotH / 70));
    const leftTicks = ticksIn(leftDom[0], leftDom[1], niceStep(leftDom[1] - leftDom[0], tickCount));
    const rightTicks = ticksIn(rightDom[0], rightDom[1], niceStep(rightDom[1] - rightDom[0], tickCount));
    const xTicks = ticksIn(xMin, xMax, niceStep(xMax - xMin, Math.max(4, Math.round(plotW / 110))));

    const barW = barWidth(data.strikes.map((s) => s.strike), xMin, xMax, plotW);

    const linePath = (key: keyof Pick<GexProfilePoint, "netGEX" | "netGEXExZeroDte">) =>
      data.profile.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.price).toFixed(1)},${yR(p[key]).toFixed(1)}`).join("");

    return {
      plotW, plotH, xMin, xMax, x, xInv, yL, yR, leftTicks, rightTicks, xTicks, barW,
      y0: yR(0),
      allPath: linePath("netGEX"),
      exPath: linePath("netGEXExZeroDte"),
    };
  }, [data, width, height]);

  const hover = useMemo(() => {
    if (hoverX === null || !layout) return null;
    const price = layout.xInv(hoverX);
    const strike = nearestBy<GexProfileStrike>(data.strikes, (s) => s.strike, price);
    const point = nearestBy<GexProfilePoint>(data.profile, (p) => p.price, price);
    return { price, strike, point };
  }, [hoverX, layout, data]);

  const { netAtSpot, flip } = data;

  return (
    <div className="gex-chart min-w-0 rounded-lg border bg-[var(--gx-panel)] px-5 pt-4 pb-3 text-[var(--gx-text)]">
      <div className="mb-1 text-xl font-semibold tracking-tight">
        {data.symbol} dealer gamma: all expiries{hasZeroDte && " vs ex-0DTE"}
      </div>
      <div className="text-xs text-[var(--gx-muted)]">
        as of {fmtAsOf(data.spotTime)} (delayed) &nbsp;|&nbsp; {data.expirationCount} expirations &nbsp;|&nbsp; $ notional per 1% move, est.
      </div>
      {data.stale && (
        <div className="mt-1.5 rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-700 dark:text-yellow-400">
          Showing the last good profile (as of {fmtAsOf(data.spotTime)}). {data.staleReason}
        </div>
      )}
      <div className="mt-2 mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span>net at {fmtPrice(data.spot)}:</span>
        <span>all expiries <span className="font-semibold text-[var(--gx-all)]">{fmtBillions(netAtSpot.all)}</span></span>
        {hasZeroDte ? (
          <>
            <span>ex-0DTE <span className="font-semibold text-[var(--gx-ex)]">{fmtBillions(netAtSpot.exZeroDte)}</span></span>
            <span>0DTE <span className="font-semibold">{fmtBillions(netAtSpot.zeroDte)}</span></span>
          </>
        ) : (
          <span className="text-[var(--gx-muted)]">no 0DTE expiration today</span>
        )}
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

            {/* grid */}
            {layout.leftTicks.map((t) => (
              <line key={`gy${t}`} x1={MARGIN.left} x2={MARGIN.left + layout.plotW} y1={layout.yL(t)} y2={layout.yL(t)} stroke="var(--gx-grid)" />
            ))}
            {layout.xTicks.map((t) => (
              <line key={`gx${t}`} x1={layout.x(t)} x2={layout.x(t)} y1={MARGIN.top} y2={MARGIN.top + layout.plotH} stroke="var(--gx-grid)" />
            ))}
            <line x1={MARGIN.left} x2={MARGIN.left + layout.plotW} y1={layout.y0} y2={layout.y0} stroke="var(--gx-axis)" />

            {/* bars: net GEX per strike, with the 0DTE share overlaid */}
            {data.strikes.map((s) => {
              const cx = layout.x(s.strike);
              const top = Math.min(layout.yL(s.netGEX), layout.y0);
              const h = Math.abs(layout.yL(s.netGEX) - layout.y0);
              return (
                <rect key={`b${s.strike}`} x={cx - layout.barW / 2} y={top} width={layout.barW} height={h}
                  fill={s.netGEX >= 0 ? "var(--gx-pos)" : "var(--gx-neg)"} />
              );
            })}
            {hasZeroDte && data.strikes.map((s) => {
              if (s.zeroDteGEX === 0) return null;
              const cx = layout.x(s.strike);
              const top = Math.min(layout.yL(s.zeroDteGEX), layout.y0);
              const h = Math.abs(layout.yL(s.zeroDteGEX) - layout.y0);
              const w = layout.barW * 0.55;
              return <rect key={`z${s.strike}`} x={cx - w / 2} y={top} width={w} height={h} fill="var(--gx-zero-dte)" />;
            })}

            {/* net GEX curves over hypothetical spot */}
            {hasZeroDte && (
              <path d={layout.exPath} fill="none" stroke="var(--gx-ex)" strokeWidth={2.6} strokeLinejoin="round" />
            )}
            <path d={layout.allPath} fill="none" stroke="var(--gx-all)" strokeWidth={2.6} strokeLinejoin="round" />

            {/* spot */}
            <SpotMarker x={layout.x(data.spot)} top={MARGIN.top} bottom={MARGIN.top + layout.plotH} spot={data.spot} />

            {/* largest 0DTE gamma */}
            {hasZeroDte && data.largestZeroDteStrike !== null && (() => {
              const s = data.strikes.find((st) => st.strike === data.largestZeroDteStrike)!;
              const px = layout.x(s.strike);
              const py = layout.yL(s.zeroDteGEX);
              const dir = s.zeroDteGEX < 0 ? 1 : -1;
              return (
                <Callout
                  x={px}
                  y={py}
                  labelX={clamp(px - 80, MARGIN.left + 70, MARGIN.left + layout.plotW - 70)}
                  labelY={clamp(py + dir * 80, MARGIN.top + 24, MARGIN.top + layout.plotH - 24)}
                  color="var(--gx-text)"
                  lines={["largest 0DTE gamma", fmtPrice(s.strike)]}
                  gap={3}
                />
              );
            })()}

            {/* flip lines */}
            {flip.all !== null && (
              <Callout
                x={layout.x(flip.all)}
                y={layout.y0}
                labelX={clamp(layout.x(flip.all) - 90, MARGIN.left + 60, MARGIN.left + layout.plotW - 60)}
                labelY={layout.y0 - 78}
                color="var(--gx-all)"
                lines={["Flip Line, all", fmtPrice(flip.all)]}
              />
            )}
            {hasZeroDte && flip.exZeroDte !== null && (
              <Callout
                x={layout.x(flip.exZeroDte)}
                y={layout.y0}
                labelX={clamp(layout.x(flip.exZeroDte) + 90, MARGIN.left + 70, MARGIN.left + layout.plotW - 70)}
                labelY={layout.y0 + 90}
                color="var(--gx-ex)"
                lines={["Flip Line, ex-0DTE", fmtPrice(flip.exZeroDte)]}
              />
            )}
            {[hasZeroDte ? flip.exZeroDte : null, flip.all].map((f, i) => f !== null && (
              <circle key={`f${i}`} cx={layout.x(f)} cy={layout.y0} r={5}
                fill={i === 0 ? "var(--gx-ex)" : "var(--gx-all)"} stroke="var(--gx-plot)" strokeWidth={1.5} />
            ))}

            {/* hover crosshair */}
            {hover && (
              <line x1={hoverX!} x2={hoverX!} y1={MARGIN.top} y2={MARGIN.top + layout.plotH} stroke="var(--gx-muted)" strokeOpacity={0.6} />
            )}

            {/* axes */}
            {layout.leftTicks.map((t) => (
              <text key={`lt${t}`} x={MARGIN.left - 8} y={layout.yL(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--gx-muted)">
                {fmtTick(t, 1e6)}
              </text>
            ))}
            {layout.rightTicks.map((t) => (
              <text key={`rt${t}`} x={MARGIN.left + layout.plotW + 8} y={layout.yR(t)} dy="0.32em" fontSize={11} fill="var(--gx-muted)">
                {fmtTick(t, 1e9)}
              </text>
            ))}
            {layout.xTicks.map((t) => (
              <text key={`xt${t}`} x={layout.x(t)} y={MARGIN.top + layout.plotH + 17} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">
                {fmtPrice(t)}
              </text>
            ))}
            <text x={MARGIN.left + layout.plotW / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">
              strike (bars) / hypothetical spot (lines)
            </text>
            <text transform={`translate(14 ${MARGIN.top + layout.plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">
              net gamma per strike at spot, $M per 1% move (est.)
            </text>
            <text transform={`translate(${width - 12} ${MARGIN.top + layout.plotH / 2}) rotate(90)`} textAnchor="middle" fontSize={11} fill="var(--gx-muted)">
              total net GEX at that price, $B per 1% move (est.)
            </text>
          </svg>
        )}

        {/* legend */}
        {layout && (
          <div
            className="pointer-events-none absolute space-y-1 rounded border border-[var(--gx-axis)] bg-[var(--gx-panel)]/85 px-2.5 py-2 text-xs"
            style={{ left: MARGIN.left + 12, top: MARGIN.top + 12 }}
          >
            <div className="flex items-center gap-2"><span className="h-[3px] w-6 rounded bg-[var(--gx-all)]" />net GEX if price moves there, all expiries</div>
            {hasZeroDte && (
              <>
                <div className="flex items-center gap-2"><span className="h-[3px] w-6 rounded bg-[var(--gx-ex)]" />same, ex-0DTE</div>
                <div className="flex items-center gap-2"><span className="h-3 w-6 rounded-sm bg-[var(--gx-zero-dte)]" />0DTE share of the bar</div>
              </>
            )}
          </div>
        )}

        {/* tooltip */}
        {layout && hover && hover.point && (
          <div
            className="pointer-events-none absolute z-10 min-w-44 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{
              top: MARGIN.top + 8,
              ...(hoverX! > width / 2 ? { right: width - hoverX! + 12 } : { left: hoverX! + 12 }),
            }}
          >
            {hover.strike && (
              <div className="mb-1.5 border-b pb-1.5">
                <div className="font-medium">Strike {fmtPrice(hover.strike.strike)}</div>
                <div>net gamma: <span className={hover.strike.netGEX >= 0 ? "text-emerald-500" : "text-rose-500"}>{fmtMillions(hover.strike.netGEX)}</span></div>
                {hasZeroDte && <div>0DTE: {fmtMillions(hover.strike.zeroDteGEX)}</div>}
              </div>
            )}
            <div className="font-medium">If spot at {fmtPrice(hover.point.price)}</div>
            <div>all expiries: <span className="font-semibold" style={{ color: "var(--gx-all)" }}>{fmtBillions(hover.point.netGEX)}</span></div>
            {hasZeroDte && (
              <div>ex-0DTE: <span className="font-semibold" style={{ color: "var(--gx-ex)" }}>{fmtBillions(hover.point.netGEXExZeroDte)}</span></div>
            )}
          </div>
        )}
      </div>

      <div className="mt-1 text-[11px] text-[var(--gx-muted)]">
        dealers assumed long calls, short puts; implied vol held fixed. estimates from Yahoo Finance open interest. not advice.
        {data.contractsWithoutIV > 0 && ` ${data.contractsWithoutIV.toLocaleString()} contracts excluded (no usable IV).`}
      </div>
    </div>
  );
}
