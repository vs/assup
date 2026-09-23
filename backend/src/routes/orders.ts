/**
 * Orders API routes
 * Provides endpoints for fetching open orders and calculating allocation impact
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { ibkrService, Position as IBPosition } from "../services/ibkr.js";
import { assignmentService, getSecurityKey } from "../services/assignment.service.js";
import { allocationService } from "../services/allocation.service.js";
import { IBKRConnectionError } from "../errors/index.js";
import { formatDisplayName, getOptionRight, simulateOrdersRequestSchema, placeOrderSchema, optionQuoteSchema, modifyOrderSchema, rollCandidatesRequestSchema, rollOrderRequestSchema } from "@assup/shared";
import type { Order, OrderImpact, PlaceOrderResult, ModifyOrderResult, OptionQuoteResult, RollCandidatesResponse } from "@assup/shared";
import { findRollCandidates } from "../services/rollCandidates.service.js";
import { placeComboOrder } from "../services/ironCondor.service.js";
import { quoteHub, quoteKey, type QuoteContract } from "../services/quotes/index.js";
import { OpenOrder as IBOpenOrder, Contract, SecType, OptionType } from "@stoqey/ib";

const router = Router();

/**
 * Enrich an IBKR order with asset class information
 */
function enrichOrder(
  order: IBOpenOrder,
  assignmentMap: Awaited<ReturnType<typeof assignmentService.getAssignmentMap>>
): Order {
  const contract = order.contract;
  const symbol = contract?.symbol || "";
  const secType = contract?.secType || "STK";
  // For options, look up assignment by underlying symbol with STK secType
  const assignmentSecType = secType === "OPT" ? "STK" : secType;
  const assignment = assignmentMap.get(getSecurityKey(symbol, assignmentSecType));
  const quantity = order.order?.totalQuantity || 0;
  const limitPrice = order.order?.lmtPrice || 0;

  return {
    orderId: order.orderId || 0,
    symbol,
    displayName: formatDisplayName(contract || {}),
    conId: contract?.conId || 0,
    secType,
    right: getOptionRight(contract || {}),
    action: order.order?.action as "BUY" | "SELL",
    quantity,
    orderType: order.order?.orderType || "",
    limitPrice,
    status: order.orderState?.status || "",
    filledQuantity: order.order?.filledQuantity || 0,
    avgFillPrice: order.orderStatus?.avgFillPrice || 0,
    assetClassId: assignment?.assetClassId || null,
    assetClassName: assignment?.assetClass.name || null,
    assetClassColor: assignment?.assetClass.color || null,
    estimatedValue: quantity * limitPrice,
  };
}

/**
 * Fetch market data (bid/ask) for orders
 * Uses the contract from each order to get current prices
 */
async function fetchMarketDataForOrders(
  orders: Order[],
  rawOrders: IBOpenOrder[]
): Promise<void> {
  // Build a map of orderId -> contract for lookup. Only single options and
  // stocks are quoted; combo (BAG) orders have no single contract to stream.
  const contractMap = new Map<number, QuoteContract>();
  for (const rawOrder of rawOrders) {
    const c = rawOrder.contract;
    if (rawOrder.orderId && c && (c.secType === "OPT" || c.secType === "STK") && c.conId) {
      contractMap.set(rawOrder.orderId, c as QuoteContract);
    }
  }
  if (contractMap.size === 0) return;

  const quotes = await quoteHub.get([...contractMap.values()], { fields: ["bid", "ask"], timeoutMs: 4000 });
  for (const order of orders) {
    const contract = contractMap.get(order.orderId);
    if (!contract) continue;
    const quote = quotes.get(quoteKey(contract));
    // Quotes are optional enrichment: a missing one leaves bid/ask unset
    order.bid = quote?.bid;
    order.ask = quote?.ask;
    if (quote && quote.status !== "ok") {
      console.warn(`[orders] No quote for order ${order.orderId} (${order.displayName}): ${quote.status}${quote.error ? ` — ${quote.error}` : ""}`);
    }
  }
}

/**
 * Fetch raw positions with error handling
 */
async function fetchRawPositions(): Promise<IBPosition[]> {
  try {
    return await ibkrService.getPositions();
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    if (error.message?.includes("does not support positions") || error.code === "timeout") {
      return [];
    }
    throw err;
  }
}

/**
 * GET /api/orders
 * Fetch open LIMIT orders from TWS
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    // Fetch orders - let errors propagate to error handler (fail fast)
    const rawOrders = await ibkrService.getAllOpenOrders();

    const assignmentMap = await assignmentService.getAssignmentMap();

    const orders = rawOrders
      .filter((o) => o.order?.orderType === "LMT")
      .map((o) => enrichOrder(o, assignmentMap));

    res.json(orders);
  })
);

/**
 * GET /api/orders/impact
 * Calculate allocation impact of open LIMIT orders
 */
router.get(
  "/impact",
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const [rawPositions, rawOrders, assignmentMap] = await Promise.all([
      fetchRawPositions(),
      ibkrService.getAllOpenOrders().catch(() => [] as IBOpenOrder[]),
      assignmentService.getAssignmentMap(),
    ]);

    const limitOrders = rawOrders.filter((o) => o.order?.orderType === "LMT");

    // Calculate current values by asset class
    const { values, totalValue: totalCurrentValue } = allocationService.calculateValuesByAssetClass(
      rawPositions.map((p) => ({
        symbol: p.contract.symbol || "",
        secType: p.contract.secType || "",
        pos: p.pos,
        avgCost: p.avgCost,
      })),
      assignmentMap
    );

    // Build order list and apply impact
    let totalProjectedValue = totalCurrentValue;
    const orders: Order[] = [];

    for (const o of limitOrders) {
      const order = enrichOrder(o, assignmentMap);
      orders.push(order);

      const delta = allocationService.applyOrderImpact(
        values,
        {
          symbol: o.contract?.symbol || "",
          secType: o.contract?.secType || "STK",
          action: order.action,
          value: order.estimatedValue || 0,
        },
        assignmentMap
      );
      totalProjectedValue += delta;
    }

    // Fetch market data (bid/ask) for all orders
    await fetchMarketDataForOrders(orders, limitOrders);

    const { currentAllocation, projectedAllocation } = allocationService.toAllocationBreakdown(
      values,
      totalCurrentValue,
      totalProjectedValue
    );

    const impact: OrderImpact = {
      orders,
      currentAllocation,
      projectedAllocation,
      totalCurrentValue,
      totalProjectedValue,
    };

    res.json(impact);
  })
);

/**
 * POST /api/orders/simulate
 * Simulate impact of hypothetical orders
 */
router.post(
  "/simulate",
  validate({ body: simulateOrdersRequestSchema }),
  asyncHandler(async (req, res) => {
    const { orders: simulatedOrders } = req.body;

    const [rawPositions, assignmentMap] = await Promise.all([
      ibkrService.isConnected() ? fetchRawPositions() : Promise.resolve([]),
      assignmentService.getAssignmentMap(),
    ]);

    // Calculate current values by asset class
    const { values, totalValue: totalCurrentValue } = allocationService.calculateValuesByAssetClass(
      rawPositions.map((p) => ({
        symbol: p.contract.symbol || "",
        secType: p.contract.secType || "",
        pos: p.pos,
        avgCost: p.avgCost,
      })),
      assignmentMap
    );

    // Apply simulated orders
    let totalProjectedValue = totalCurrentValue;
    for (const order of simulatedOrders) {
      const delta = allocationService.applyOrderImpact(
        values,
        {
          symbol: order.symbol.toUpperCase(),
          secType: order.secType || "STK",
          action: order.action,
          value: order.quantity * order.price,
        },
        assignmentMap
      );
      totalProjectedValue += delta;
    }

    const { currentAllocation, projectedAllocation } = allocationService.toAllocationBreakdown(
      values,
      totalCurrentValue,
      totalProjectedValue
    );

    res.json({
      orders: simulatedOrders,
      currentAllocation,
      projectedAllocation,
      totalCurrentValue,
      totalProjectedValue,
    });
  })
);

/**
 * POST /api/orders/place
 * Place a new option order with TWS
 */
router.post(
  "/place",
  validate({ body: placeOrderSchema }),
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const { symbol, expiration, strike, right, action, quantity, limitPrice, tif, tradingClass } = req.body;

    // Build the option contract. Use explicit tradingClass when provided
    // (e.g. XSPW for XSP options listed under SPX symbol).
    const contract: Contract = {
      symbol,
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: expiration,
      strike,
      right: right === "C" ? OptionType.Call : OptionType.Put,
      multiplier: 100,
      tradingClass: tradingClass ?? symbol,
    };

    // Place the order
    const orderId = await ibkrService.placeOrder(contract, {
      action,
      quantity,
      limitPrice,
      orderType: "LMT",
      tif,
    });

    const result: PlaceOrderResult = {
      orderId,
      symbol,
      action,
      quantity,
      limitPrice,
    };

    res.status(201).json(result);
  })
);

/**
 * POST /api/orders/quote
 * Get a live bid/ask quote for an option contract
 */
router.post(
  "/quote",
  validate({ body: optionQuoteSchema }),
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const { symbol, expiration, strike, right, conId } = req.body;

    const contract: QuoteContract = {
      conId,
      symbol,
      secType: "OPT",
      currency: "USD",
      lastTradeDateOrContractMonth: expiration,
      strike,
      right,
      multiplier: 100,
      tradingClass: symbol,
    };

    const quote = (await quoteHub.get([contract], { fields: ["bid", "ask"] })).get(quoteKey(contract))!;

    const bid = quote.bid ?? null;
    const ask = quote.ask ?? null;
    const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
    const last = quote.last ?? null;

    const result: OptionQuoteResult = {
      bid,
      ask,
      mid,
      last,
      status: quote.status,
      error: quote.status === "ok"
        ? undefined
        : quote.error ??
          `No ${[bid == null ? "bid" : null, ask == null ? "ask" : null].filter(Boolean).join(" or ") || "quote"} ` +
            `from TWS for ${symbol} ${expiration} ${strike}${right} (${quote.status})`,
    };
    res.json(result);
  })
);

/**
 * PUT /api/orders/:id
 * Modify an existing order's limit price and/or quantity
 */
router.put(
  "/:id",
  validate({ body: modifyOrderSchema }),
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      res.status(400).json({ error: "Invalid order ID" });
      return;
    }

    const { limitPrice, quantity, tif } = req.body;

    // Find the existing order to get its contract and action
    const rawOrders = await ibkrService.getAllOpenOrders();
    const existingOrder = rawOrders.find((o) => o.orderId === orderId);

    if (!existingOrder) {
      res.status(404).json({ error: `Order ${orderId} not found in open orders` });
      return;
    }

    if (!existingOrder.contract) {
      res.status(400).json({ error: `Order ${orderId} has no contract` });
      return;
    }

    const action = (existingOrder.order?.action || "BUY") as "BUY" | "SELL";

    await ibkrService.modifyOrder(orderId, existingOrder.contract, {
      action,
      quantity,
      limitPrice,
      tif,
    });

    const result: ModifyOrderResult = { orderId, limitPrice, quantity };
    res.json(result);
  })
);

/**
 * DELETE /api/orders/:id
 * Cancel an existing order
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      res.status(400).json({ error: "Invalid order ID" });
      return;
    }

    await ibkrService.cancelOrder(orderId);
    res.status(204).end();
  })
);

/**
 * POST /api/orders/roll-candidates
 * Find roll candidates for a short option position.
 * Returns close-leg prices and profitable roll candidates sorted by net credit.
 */
router.post(
  "/roll-candidates",
  validate({ body: rollCandidatesRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    // Abort IBKR processing when the client disconnects before we finish.
    // Use res.on('close') rather than req.on('close'): the request stream can
    // emit 'close' as soon as body-parser consumes the body (before our async
    // work starts), which would abort the controller prematurely.
    // res.on('close') fires only when the connection is destroyed without a
    // completed response — i.e. the client genuinely disconnected mid-scan.
    const cancelController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) cancelController.abort();
    });

    const result: RollCandidatesResponse = await findRollCandidates(req.body, cancelController.signal);
    res.json(result);
  })
);

/**
 * POST /api/orders/roll
 * Place a roll combo order: BUY-to-close current + SELL-to-open replacement.
 * limitPrice is the net credit to receive (positive); negated for IBKR convention.
 */
router.post(
  "/roll",
  validate({ body: rollOrderRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const { symbol, closeConId, openExpiration, openStrike, openRight, quantity, limitPrice } = req.body;
    let { openConId } = req.body;

    // conId may be 0 when pre-resolution failed during roll-candidates fetch.
    // Resolve it now using the contract spec — single targeted lookup, not a full chain scan.
    if (openConId === 0) {
      const conIdMap = await ibkrService.resolveOptionConIds(symbol, openExpiration, symbol, 100);
      openConId = conIdMap.get(`${openStrike}:${openRight}`) ?? 0;
      if (openConId === 0) {
        throw new Error(`Could not resolve contract ID for ${symbol} ${openExpiration} ${openStrike} ${openRight}`);
      }
    }

    const result = await placeComboOrder({
      symbol,
      legs: [
        { conId: closeConId, strike: 0, type: "CALL", side: "BUY", expiration: "", exchange: "SMART" },
        { conId: openConId, strike: 0, type: "CALL", side: "SELL", expiration: "", exchange: "SMART" },
      ],
      quantity,
      limitPrice: -limitPrice, // negate: IBKR convention negative = credit received
    });

    res.status(201).json(result);
  })
);

export default router;
