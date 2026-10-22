/**
 * Shared scale/format helpers for the GEX modal charts.
 */
import { useLayoutEffect, useRef, useState } from "react";

export const MINUS = "−";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function niceStep(span: number, count: number): number {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

export function ticksIn(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** Bar width that leaves a gap between the closest pair of strikes. */
export function barWidth(strikes: number[], xMin: number, xMax: number, plotW: number): number {
  let minGap = Infinity;
  for (let i = 1; i < strikes.length; i++) minGap = Math.min(minGap, strikes[i] - strikes[i - 1]);
  const gapPx = Number.isFinite(minGap) ? (minGap / (xMax - xMin)) * plotW : 8;
  return clamp(gapPx * 0.72, 1.5, 12);
}

export function fmtPrice(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function nearestBy<T>(items: T[], key: (t: T) => number, x: number): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const it of items) {
    const d = Math.abs(key(it) - x);
    if (d < bestDist) {
      bestDist = d;
      best = it;
    }
  }
  return best;
}

/** Width of the referenced element, tracked with a ResizeObserver. */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
