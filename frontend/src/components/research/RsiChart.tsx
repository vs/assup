import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  LineSeries,
} from "lightweight-charts";
import type {
  IChartApi,
  LineData,
  Time,
} from "lightweight-charts";
import type { OHLCV } from "@assup/shared";
import { computeRSI } from "@/utils/indicators";

interface RsiChartProps {
  ohlcv: OHLCV[];
}

export function RsiChart({ ohlcv }: RsiChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || ohlcv.length === 0) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(107, 114, 128, 0.1)" },
        horzLines: { color: "rgba(107, 114, 128, 0.1)" },
      },
      width: container.clientWidth,
      height: 120,
      crosshair: { mode: 0 },
      timeScale: { borderColor: "rgba(107, 114, 128, 0.3)" },
      rightPriceScale: {
        borderColor: "rgba(107, 114, 128, 0.3)",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
    });
    chartRef.current = chart;

    const rsiValues = computeRSI(ohlcv, 14);
    const rsiSeries = chart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const rsiData: LineData<Time>[] = ohlcv
      .map((d, i) =>
        rsiValues[i] != null
          ? { time: d.date as Time, value: rsiValues[i] as number }
          : null,
      )
      .filter((d): d is LineData<Time> => d !== null);
    rsiSeries.setData(rsiData);

    rsiSeries.createPriceLine({
      price: 70,
      color: "rgba(239, 68, 68, 0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "",
    });
    rsiSeries.createPriceLine({
      price: 30,
      color: "rgba(34, 197, 94, 0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "",
    });
    rsiSeries.createPriceLine({
      price: 50,
      color: "rgba(107, 114, 128, 0.3)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "",
    });

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [ohlcv]);

  return (
    <div>
      <div className="text-xs text-muted-foreground px-1 mb-1">RSI (14)</div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
