export type CalendarEventType =
  | "EARNINGS"
  | "DIVIDEND_ANNOUNCED"
  | "DIVIDEND_EX_DATE"
  | "DIVIDEND_PAYMENT"
  | "OPTION_EXPIRATION"
  | "STOCK_SPLIT"
  | "MERGER"
  | "SEC_FILING"
  | "FOMC"
  | "CPI"
  | "GDP"
  | "JOBS_REPORT"
  | "FED_SPEECH";

export type CalendarEventCategory =
  | "expiration"
  | "earnings_dividend"
  | "fomc"
  | "macro"
  | "corporate";

export interface CalendarEvent {
  id: string;
  eventType: CalendarEventType;
  symbol: string | null;
  date: string; // ISO date string YYYY-MM-DD
  title: string;
  details: Record<string, unknown> | null;
  source: string;
  sourceId: string | null;
  /**
   * True when this event's symbol is tracked for market impact rather than
   * held in the portfolio. Derived at read time from the current positions —
   * never stored, because holdings change.
   */
  marketWide?: boolean;
}

export type WeekStartDay = "monday" | "sunday";

export interface CalendarSettings {
  excludedEventTypes: CalendarEventType[];
  excludeSpreadExpirations: boolean;
  weekStartDay: WeekStartDay;
  /** Symbols whose earnings show even when not held. */
  marketWideSymbols: string[];
  includeMarketWideEarnings: boolean;
}

/**
 * The MAG7 — applied only when the setting row has never been written.
 * A saved empty array is a deliberate "track nothing" and is left alone.
 */
export const DEFAULT_MARKET_WIDE_SYMBOLS = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
] as const;

export const EVENT_TYPE_CATEGORY: Record<CalendarEventType, CalendarEventCategory> = {
  OPTION_EXPIRATION: "expiration",
  EARNINGS: "earnings_dividend",
  DIVIDEND_ANNOUNCED: "earnings_dividend",
  DIVIDEND_EX_DATE: "earnings_dividend",
  DIVIDEND_PAYMENT: "earnings_dividend",
  FOMC: "fomc",
  CPI: "macro",
  GDP: "macro",
  JOBS_REPORT: "macro",
  FED_SPEECH: "macro",
  STOCK_SPLIT: "corporate",
  MERGER: "corporate",
  SEC_FILING: "corporate",
};

export const EVENT_CATEGORY_COLOR: Record<CalendarEventCategory, string> = {
  expiration: "#2563eb",
  earnings_dividend: "#d97706",
  fomc: "#dc2626",
  macro: "#16a34a",
  corporate: "#7c3aed",
};
