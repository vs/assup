import { describe, it, expect } from "vitest";
import { getEventSession } from "@assup/shared";

describe("getEventSession", () => {
  it.each([
    ["bmo", "before_open"],
    ["dmh", "during_market"],
    ["amc", "after_close"],
  ])("maps an earnings hour of %s to %s", (hour, session) => {
    expect(getEventSession({ eventType: "EARNINGS", details: { hour } })).toBe(session);
  });

  it.each([
    ["an unconfirmed hour", { hour: null }],
    ["an empty hour", { hour: "" }],
    ["an unrecognised hour", { hour: "tbd" }],
    ["no details", null],
  ])("leaves earnings with %s unmarked", (_label, details) => {
    expect(getEventSession({ eventType: "EARNINGS", details })).toBeNull();
  });

  it.each(["CPI", "JOBS_REPORT", "GDP"] as const)(
    "places the 8:30 ET %s release before the open",
    (eventType) => {
      expect(getEventSession({ eventType, details: null })).toBe("before_open");
    }
  );

  it("places the 2:00 pm ET FOMC decision during market hours", () => {
    expect(getEventSession({ eventType: "FOMC", details: null })).toBe("during_market");
  });

  it.each([
    "DIVIDEND_ANNOUNCED",
    "DIVIDEND_EX_DATE",
    "DIVIDEND_PAYMENT",
    "OPTION_EXPIRATION",
    "STOCK_SPLIT",
    "MERGER",
    "SEC_FILING",
    "FED_SPEECH",
  ] as const)("leaves %s unmarked", (eventType) => {
    expect(getEventSession({ eventType, details: null })).toBeNull();
  });

  it("ignores an hour on a non-earnings event", () => {
    expect(
      getEventSession({ eventType: "DIVIDEND_EX_DATE", details: { hour: "amc" } })
    ).toBeNull();
  });
});
