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
import { formatDisplayName, getOptionRight, simulateOrdersRequestSchema, placeOrderSchema, optionQuoteSchema, modifyOrderSchema } from "@assup/shared";
import type { Order, OrderImpact, PlaceOrderResult, ModifyOrderResult, OptionQuoteResult } from "@assup/shared";
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
  // Build a map of orderId -> contract for lookup
  const contractMap = new Map<number, Contract>();
  for (const rawOrder of rawOrders) {
    if (rawOrder.orderId && rawOrder.contract) {
      contractMap.set(rawOrder.orderId, rawOrder.contract);
    }
  }

  // Fetch market data for each order in parallel
  const promises = orders.map(async (order) => {
    const contract = contractMap.get(order.orderId);
    if (!contract) return;

    try {
      const marketData = await ibkrService.getMarketData(contract);
      if (marketData) {
        order.bid = marketData.bid;
        order.ask = marketData.ask;
      }
    } catch (err) {
      // Log but don't fail - market data is optional
      console.debug(`Failed to get market data for order ${order.orderId}:`, err);
    }
  });

  await Promise.allSettled(promises);
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

    const { symbol, expiration, strike, right, action, quantity, limitPrice } = req.body;

    // Build the option contract
    const contract: Contract = {
      symbol,
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: expiration,
      strike,
      right: right === "C" ? OptionType.Call : OptionType.Put,
    };

    // Place the order
    const orderId = await ibkrService.placeOrder(contract, {
      action,
      quantity,
      limitPrice,
      orderType: "LMT",
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

    const { symbol, expiration, strike, right } = req.body;

    const contract: Contract = {
      symbol,
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: expiration,
      strike,
      right: right === "C" ? OptionType.Call : OptionType.Put,
    };

    const marketData = await ibkrService.getMarketData(contract);

    const bid = marketData?.bid ?? null;
    const ask = marketData?.ask ?? null;
    const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
    const last = marketData?.last ?? null;

    const result: OptionQuoteResult = { bid, ask, mid, last };
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

    const { limitPrice, quantity } = req.body;

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

export default router;
