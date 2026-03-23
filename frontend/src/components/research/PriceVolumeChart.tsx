import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import type {
  IChartApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
} from "lightweight-charts";
import type { OHLCV } from "@assup/shared";
import { computeSMA } from "@/utils/indicators";

interface PriceVolumeChartProps {
  ohlcv: OHLCV[];
  support: number | null;
  resistance: number | null;
}

export function PriceVolumeChart({
  ohlcv,
  support,
  resistance,
}: PriceVolumeChartProps) {
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
      height: 360,
      crosshair: { mode: 0 },
      timeScale: { borderColor: "rgba(107, 114, 128, 0.3)" },
      rightPriceScale: { borderColor: "rgba(107, 114, 128, 0.3)" },
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const candleData: CandlestickData<Time>[] = ohlcv.map((d) => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    candleSeries.setData(candleData);

    // Volume histogram
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const volumeData: HistogramData<Time>[] = ohlcv.map((d) => ({
      time: d.date as Time,
      value: d.volume,
      color:
        d.close >= d.open
          ? "rgba(34, 197, 94, 0.3)"
          : "rgba(239, 68, 68, 0.3)",
    }));
    volumeSeries.setData(volumeData);

    // SMA overlays
    const sma50 = computeSMA(ohlcv, 50);
    const sma200 = computeSMA(ohlcv, 200);

    const sma50Series = chart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma50Data: LineData<Time>[] = ohlcv
      .map((d, i) =>
        sma50[i] != null
          ? { time: d.date as Time, value: sma50[i] as number }
          : null,
      )
      .filter((d): d is LineData<Time> => d !== null);
    sma50Series.setData(sma50Data);

    const sma200Series = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma200Data: LineData<Time>[] = ohlcv
      .map((d, i) =>
        sma200[i] != null
          ? { time: d.date as Time, value: sma200[i] as number }
          : null,
      )
      .filter((d): d is LineData<Time> => d !== null);
    sma200Series.setData(sma200Data);

    // Support/Resistance lines
    if (support != null) {
      candleSeries.createPriceLine({
        price: support,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "S",
      });
    }
    if (resistance != null) {
      candleSeries.createPriceLine({
        price: resistance,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "R",
      });
    }

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
  }, [ohlcv, support, resistance]);

  return <div ref={chartContainerRef} className="w-full" />;
}
