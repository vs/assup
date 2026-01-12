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
import { formatDisplayName, getOptionRight, simulateOrdersRequestSchema } from "@assup/shared";
import type { Order, OrderImpact } from "@assup/shared";
import { OpenOrder as IBOpenOrder } from "@stoqey/ib";

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
  const assignment = assignmentMap.get(getSecurityKey(symbol, secType));
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

    let rawOrders: IBOpenOrder[] = [];
    try {
      rawOrders = await ibkrService.getAllOpenOrders();
    } catch (err) {
      console.error("Error fetching orders:", err);
      rawOrders = [];
    }

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

export default router;
