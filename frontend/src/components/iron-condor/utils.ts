import type { SpreadMode } from "@assup/shared";

export function spreadModeLabel(mode: SpreadMode): string {
  switch (mode) {
    case "put-spread": return "Put Spread";
    case "call-spread": return "Call Spread";
    case "iron-condor": return "Iron Condor";
  }
}
