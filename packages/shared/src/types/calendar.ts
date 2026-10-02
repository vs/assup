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

/** Where an event falls relative to the regular US trading session. */
export type CalendarEventSession = "before_open" | "during_market" | "after_close";

export const EVENT_SESSION_LABEL: Record<CalendarEventSession, string> = {
  before_open: "Before open",
  during_market: "During market",
  after_close: "After close",
};

/** Finnhub's earnings `hour` codes. */
const EARNINGS_HOUR_SESSION: Record<string, CalendarEventSession> = {
  bmo: "before_open",
  dmh: "during_market",
  amc: "after_close",
};

/**
 * Macro releases keep a fixed time of day: CPI, the jobs report and GDP come
 * out at 8:30 ET, the FOMC decision at 2:00 pm ET. Fed speeches have no fixed
 * slot, so they stay unmarked.
 */
const MACRO_SESSION: Partial<Record<CalendarEventType, CalendarEventSession>> = {
  CPI: "before_open",
  JOBS_REPORT: "before_open",
  GDP: "before_open",
  FOMC: "during_market",
};

/**
 * The session an event is scheduled in, or null when it has none or the
 * source has not confirmed it — an unconfirmed earnings hour is never guessed.
 */
export function getEventSession(
  event: Pick<CalendarEvent, "eventType" | "details">
): CalendarEventSession | null {
  if (event.eventType === "EARNINGS") {
    const hour = event.details?.hour;
    return typeof hour === "string" ? (EARNINGS_HOUR_SESSION[hour] ?? null) : null;
  }
  return MACRO_SESSION[event.eventType] ?? null;
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
