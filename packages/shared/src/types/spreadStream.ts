import type { IronCondorChainStrike, ActiveSpread } from "./ironCondor.js";

export interface SpreadStreamInitEvent {
  underlyingPrice: number;
  expirations: string[];
  selectedExpiration: string;
  chain: IronCondorChainStrike[];
  /** true when backend is in scout phase — frontend should not auto-select yet */
  scouting: boolean;
}

export interface ChainUpdateEvent {
  underlyingPrice?: number;
  updates: Array<{
    strike: number;
    right: "P" | "C";
    bid?: number;
    ask?: number;
    mid?: number;
    delta?: number;
    iv?: number;
    last?: number;
  }>;
}

export interface PositionsUpdateEvent {
  spreads: ActiveSpread[];
}

export interface StreamErrorEvent {
  message: string;
  recoverable: boolean;
}

export interface RefocusedEvent {
  focusRanges: Array<{ min: number; max: number }>;
}

export type SpreadStreamEvent =
  | { type: "init"; data: SpreadStreamInitEvent }
  | { type: "chain-update"; data: ChainUpdateEvent }
  | { type: "positions"; data: PositionsUpdateEvent }
  | { type: "refocused"; data: RefocusedEvent }
  | { type: "error"; data: StreamErrorEvent };
