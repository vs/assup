/**
 * Iron Condor Builder service
 * Handles combo order placement via IBKR.
 */

import {
  Contract,
  SecType,
  OptionType,
  OrderAction,
  OrderType,
  TimeInForce,
} from "@stoqey/ib";
import type { Order } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { SYMBOL_CONFIG, roundToTickSize, isIndexSymbol } from "../utils/options.js";
import type {
  IronCondorOrderRequest,
  IronCondorOrderResponse,
  SingleOrderRequest,
  SingleOrderResponse,
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

  // Build BAG contract — symbol must match the underlying of the option legs
  // (e.g. XSP legs require BAG symbol "XSP", not "SPX", since the leg conIds
  // come from XSP's option chain).
  const config = SYMBOL_CONFIG[req.symbol];
  const bagSymbol = req.symbol;
  // Index options (SPX, XSP, RUT) trade exclusively on CBOE. Use direct CBOE routing
  // to avoid TWS error 10043 ("Missing or invalid NonGuaranteed value") which occurs
  // when SMART routing requires NonGuaranteed for mixed-action combo legs.
  // For unknown symbols fall back to SMART with NonGuaranteed.
  const comboExchange = config?.comboExchange ?? "SMART";
  const comboContract: Contract = {
    symbol: bagSymbol,
    secType: "BAG" as SecType,
    exchange: comboExchange,
    currency: "USD",
    comboLegs: req.legs.map(leg => ({
      conId: leg.conId,
      ratio: 1,
      action: leg.side === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      exchange: comboExchange,
      openClose: 0,          // 0 = Same (retail default, required by TWS)
      shortSaleSlot: 0,      // 0 = not short sale
      designatedLocation: "", // empty when shortSaleSlot = 0
      exemptCode: -1,        // -1 = not exempt (IBKR default per official API)
    })),
  };

  // Build order — action is "BUY" for the combo.
  // IBKR BAG convention: order-level action = BUY, each ComboLeg specifies its own action.
  // Limit price follows IBKR sign convention: negative = credit (min credit to receive),
  // positive = debit (max debit to pay). Callers must pass the correctly signed value.
  // Round to minimum tick size — IBKR rejects prices that don't conform (Error 110).
  const tickSize = config?.comboTickSize ?? 0.01;
  const lmtPrice = roundToTickSize(req.limitPrice, tickSize);
  const order: Order = {
    action: OrderAction.BUY,
    totalQuantity: req.quantity,
    orderType: OrderType.LMT,
    lmtPrice,
    tif: TimeInForce.DAY,
    transmit: true,
    // SmartComboRoutingParams only needed for SMART-routed combos (NonGuaranteed flag).
    // For direct exchange routing (e.g. CBOE), omit to avoid error 10043.
    ...(comboExchange === "SMART" && {
      smartComboRoutingParams: [
        { tag: "NonGuaranteed", value: "1" },
      ],
    }),
  };

  const orderId = await api.placeNewOrder(comboContract, order);

  // Confirmation is centralised in ibkrService: order-level TWS errors are
  // captured by the global error subscriber, so a rejection delivered before
  // this point is still reported. The previous per-call subscription attached
  // after placeNewOrder() resolved and could miss exactly that case.
  const status = await ibkrService.confirmOrder(orderId);
  return { orderId, status };
}

/**
 * Place a single-leg option order via IBKR.
 */
export async function placeSingleOrder(req: SingleOrderRequest): Promise<SingleOrderResponse> {
  const api = ibkrService.getApi();
  if (!api || !api.isConnected) {
    throw new Error("Not connected to TWS");
  }

  const exchange = isIndexSymbol(req.symbol) ? "CBOE" : "SMART";
  const contract: Contract = {
    conId: req.conId,
    symbol: req.symbol,
    secType: SecType.OPT,
    exchange,
    currency: "USD",
    lastTradeDateOrContractMonth: req.expiration,
    strike: req.strike,
    right: req.right === "C" ? OptionType.Call : OptionType.Put,
  };

  const lmtPrice = roundToTickSize(req.limitPrice, 0.01);
  const order: Order = {
    action: req.action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
    totalQuantity: req.quantity,
    orderType: OrderType.LMT,
    lmtPrice,
    tif: TimeInForce.DAY,
    transmit: true,
  };

  const orderId = await api.placeNewOrder(contract, order);

  const status = await ibkrService.confirmOrder(orderId);
  return { orderId, status };
}
