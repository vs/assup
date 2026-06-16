/**
 * Iron Condor Builder service
 * Handles combo order placement via IBKR.
 */

import {
  Contract,
  SecType,
  OrderAction,
  OrderType,
  TimeInForce,
} from "@stoqey/ib";
import type { Order } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { SYMBOL_CONFIG } from "../utils/options.js";
import type {
  IronCondorOrderRequest,
  IronCondorOrderResponse,
} from "@assup/shared";

// --- Combo Order ---

/**
 * Place an iron condor as a multi-leg combo (BAG) order via IBKR.
 */
export async function placeComboOrder(req: IronCondorOrderRequest): Promise<IronCondorOrderResponse> {
  const api = ibkrService.getApi();
  if (!api || !api.isConnected) {
    throw new Error("Not connected to TWS");
  }

  // Build BAG contract — use the IBKR option symbol (e.g. XSP options use SPX)
  const config = SYMBOL_CONFIG[req.symbol];
  const bagSymbol = config?.optionSymbol ?? req.symbol;
  const comboContract: Contract = {
    symbol: bagSymbol,
    secType: "BAG" as SecType,
    exchange: "SMART",
    currency: "USD",
    comboLegs: req.legs.map(leg => ({
      conId: leg.conId,
      ratio: 1,
      action: leg.side === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      exchange: leg.exchange,
    })),
  };

  // Build order — action is "BUY" for the combo.
  // IBKR BAG convention: order-level action = BUY, each ComboLeg specifies its own action.
  // The net credit is received because the sold legs generate more premium than the bought legs cost.
  // Limit price is the net credit we want to receive (positive = credit for the combo).
  // Round to nearest cent — IBKR rejects prices that don't conform to minimum tick size.
  const lmtPrice = Math.round(req.limitPrice * 100) / 100;
  const order: Order = {
    action: OrderAction.BUY,
    totalQuantity: req.quantity,
    orderType: OrderType.LMT,
    lmtPrice,
    tif: TimeInForce.DAY,
    transmit: true,
    smartComboRoutingParams: [
      { tag: "NonGuaranteed", value: "1" },
    ],
  };

  const orderId = await api.placeNewOrder(comboContract, order);

  // Wait for order confirmation (same pattern as ibkrService.placeOrder)
  const maxWaitMs = 3000;
  const pollIntervalMs = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    try {
      const orders = await ibkrService.getAllOpenOrders();
      const found = orders.find((o) => o.orderId === orderId);
      if (found) {
        const status = found.orderStatus?.status || found.orderState?.status;
        if (status === "Cancelled" || status === "Inactive") {
          throw new Error(`Order was ${status.toLowerCase()} by TWS`);
        }
        if (status === "PreSubmitted" || status === "Submitted" || status === "Filled") {
          return { orderId, status };
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Order was")) throw err;
    }
  }

  return { orderId, status: "Submitted" };
}
