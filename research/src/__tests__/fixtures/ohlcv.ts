import type { OHLCV } from "../../providers/types.js";

/** Generate N days of OHLCV data ending today with a configurable trend. */
export function generateOHLCV(days: number, opts: { startPrice?: number; trend?: "up" | "down" | "flat" } = {}): OHLCV[] {
  const { startPrice = 100, trend = "flat" } = opts;
  const data: OHLCV[] = [];
  let price = startPrice;

  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - (days - i) * 86400000).toISOString().split("T")[0];
    const change = trend === "up" ? 0.3 : trend === "down" ? -0.3 : (Math.random() - 0.5) * 0.5;
    price = Math.max(1, price + change);
    const high = price + 1;
    const low = price - 1;
    data.push({ date, open: price - 0.1, high, low, close: price, volume: 1000000 + i * 1000 });
  }
  return data;
}
