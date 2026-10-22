/**
 * Shared SVG pieces for the GEX modal charts (colors come from the
 * `.gex-chart` CSS variables in index.css).
 */
import { fmtPrice } from "./gexChartHelpers";

interface CalloutProps {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  color: string;
  lines: [string, string];
  /** Gap left between arrow tip and target point. */
  gap?: number;
}

/** Two-line label with a straight arrow pointing at (x, y). */
export function Callout({ x, y, labelX, labelY, color, lines, gap = 6 }: CalloutProps) {
  const below = labelY > y;
  const startY = below ? labelY - 16 : labelY + 22;
  const dx = x - labelX;
  const dy = y - startY;
  const len = Math.hypot(dx, dy) || 1;
  const tipX = x - (dx / len) * gap;
  const tipY = y - (dy / len) * gap;
  const angle = Math.atan2(dy, dx);
  const head = 7;
  const p1 = `${tipX - head * Math.cos(angle - 0.4)},${tipY - head * Math.sin(angle - 0.4)}`;
  const p2 = `${tipX - head * Math.cos(angle + 0.4)},${tipY - head * Math.sin(angle + 0.4)}`;
  return (
    <g>
      <line x1={labelX} y1={startY} x2={tipX} y2={tipY} stroke={color} strokeWidth={1.4} />
      <polygon points={`${tipX},${tipY} ${p1} ${p2}`} fill={color} />
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        fill={color}
        fontSize={13}
        fontWeight={600}
        stroke="var(--gx-plot)"
        strokeWidth={4}
        paintOrder="stroke"
      >
        <tspan x={labelX}>{lines[0]}</tspan>
        <tspan x={labelX} dy={16}>{lines[1]}</tspan>
      </text>
    </g>
  );
}

interface SpotMarkerProps {
  x: number;
  top: number;
  bottom: number;
  spot: number;
}

/** Dashed vertical spot line with its label above the plot. */
export function SpotMarker({ x, top, bottom, spot }: SpotMarkerProps) {
  return (
    <>
      <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--gx-text)" strokeWidth={1.4} strokeDasharray="5 4" />
      <text x={x} y={top - 10} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--gx-text)">
        spot {fmtPrice(spot)}
      </text>
    </>
  );
}
