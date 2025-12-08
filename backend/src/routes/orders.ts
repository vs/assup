import { Router, Request, Response } from "express";
import { ibkrService } from "../services/ibkr.js";
import { prisma } from "../db/index.js";

const router = Router();

export interface Order {
  orderId: number;
  symbol: string;
  conId: number;
  secType: string;
  action: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  limitPrice?: number;
  status: string;
  filledQuantity: number;
  avgFillPrice: number;
  // Enriched data
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
  // Calculated impact
  estimatedValue?: number;
}

export interface OrderImpact {
  orders: Order[];
  currentAllocation: { id: string; name: string; color: string; value: number; percentage: number }[];
  projectedAllocation: { id: string; name: string; color: string; value: number; percentage: number }[];
  totalCurrentValue: number;
  totalProjectedValue: number;
}

// GET /api/orders - Fetch open LIMIT orders from TWS
router.get("/", async (req: Request, res: Response) => {
  try {
    const client = ibkrService.getClient();
    if (!client) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    // Fetch all open orders from TWS
    let rawOrders: any[] = [];
    try {
      // getAllOpenOrders exists in ib-tws-api but isn't typed
      const result = await (client as any).getAllOpenOrders();
      rawOrders = Array.isArray(result) ? result : [];
    } catch (err: any) {
      console.error("Error fetching orders:", err);
      // Return empty array if order fetching fails
      rawOrders = [];
    }

    // Get security assignments for enrichment
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a])
    );

    // Filter to LIMIT orders only and map to our Order structure
    const orders: Order[] = rawOrders
      .filter((o) => o.order?.orderType === "LMT")
      .map((o) => {
        const symbol = o.contract?.symbol || "";
        const secType = o.contract?.secType || "STK";
        const key = `${symbol}:${secType}`;
        const assignment = assignmentMap.get(key);
        const quantity = o.order?.totalQuantity || 0;
        const limitPrice = o.order?.lmtPrice || 0;

        return {
          orderId: o.order?.orderId || 0,
          symbol,
          conId: o.contract?.conId || 0,
          secType,
          action: o.order?.action as "BUY" | "SELL",
          quantity,
          orderType: o.order?.orderType || "",
          limitPrice,
          status: o.orderState?.status || "",
          filledQuantity: o.order?.filledQuantity || 0,
          avgFillPrice: o.order?.avgFillPrice || 0,
          assetClassId: assignment?.assetClassId || null,
          assetClassName: assignment?.assetClass.name || null,
          assetClassColor: assignment?.assetClass.color || null,
          estimatedValue: quantity * limitPrice,
        };
      });

    res.json(orders);
  } catch (error) {
    console.error("Failed to fetch orders:", error);
    res.status(500).json({ error: "Failed to fetch orders from TWS" });
  }
});

// GET /api/orders/impact - Calculate allocation impact of open LIMIT orders
router.get("/impact", async (req: Request, res: Response) => {
  try {
    const client = ibkrService.getClient();
    if (!client) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    // Get current positions
    let rawPositions: any[] = [];
    try {
      const result = await client.getPositions();
      rawPositions = Array.isArray(result) ? result : [];
    } catch (err: any) {
      if (!err.message?.includes("does not support positions") && err.code !== "timeout") {
        throw err;
      }
    }

    // Fetch all open orders from TWS
    let rawOrders: any[] = [];
    try {
      // getAllOpenOrders exists in ib-tws-api but isn't typed
      const result = await (client as any).getAllOpenOrders();
      rawOrders = Array.isArray(result) ? result : [];
    } catch (err: any) {
      console.error("Error fetching orders for impact:", err);
      rawOrders = [];
    }

    // Filter to LIMIT orders only
    const limitOrders = rawOrders.filter((o) => o.order?.orderType === "LMT");

    // Get security assignments
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a])
    );

    // Calculate current values by asset class
    const valuesByAssetClass: Record<string, { name: string; color: string; current: number; projected: number }> = {};
    let totalCurrentValue = 0;

    for (const p of rawPositions) {
      const value = Math.abs(p.pos * p.avgCost);
      totalCurrentValue += value;

      const key = `${p.contract.symbol}:${p.contract.secType}`;
      const assignment = assignmentMap.get(key);

      if (assignment) {
        if (!valuesByAssetClass[assignment.assetClassId]) {
          valuesByAssetClass[assignment.assetClassId] = {
            name: assignment.assetClass.name,
            color: assignment.assetClass.color,
            current: 0,
            projected: 0,
          };
        }
        valuesByAssetClass[assignment.assetClassId].current += value;
        valuesByAssetClass[assignment.assetClassId].projected += value;
      }
    }

    // Build order list and apply impact
    let totalProjectedValue = totalCurrentValue;
    const orders: Order[] = [];

    for (const o of limitOrders) {
      const symbol = o.contract?.symbol || "";
      const secType = o.contract?.secType || "STK";
      const key = `${symbol}:${secType}`;
      const assignment = assignmentMap.get(key);
      const quantity = o.order?.totalQuantity || 0;
      const limitPrice = o.order?.lmtPrice || 0;
      const action = o.order?.action as "BUY" | "SELL";
      const orderValue = quantity * limitPrice;

      orders.push({
        orderId: o.order?.orderId || 0,
        symbol,
        conId: o.contract?.conId || 0,
        secType,
        action,
        quantity,
        orderType: o.order?.orderType || "",
        limitPrice,
        status: o.orderState?.status || "",
        filledQuantity: o.order?.filledQuantity || 0,
        avgFillPrice: o.order?.avgFillPrice || 0,
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
        estimatedValue: orderValue,
      });

      // Apply order impact to projected values
      if (assignment) {
        if (!valuesByAssetClass[assignment.assetClassId]) {
          valuesByAssetClass[assignment.assetClassId] = {
            name: assignment.assetClass.name,
            color: assignment.assetClass.color,
            current: 0,
            projected: 0,
          };
        }

        if (action === "BUY") {
          valuesByAssetClass[assignment.assetClassId].projected += orderValue;
          totalProjectedValue += orderValue;
        } else if (action === "SELL") {
          valuesByAssetClass[assignment.assetClassId].projected -= orderValue;
          totalProjectedValue -= orderValue;
        }
      }
    }

    // Build response
    const currentAllocation = Object.entries(valuesByAssetClass).map(([id, data]) => ({
      id,
      name: data.name,
      color: data.color,
      value: data.current,
      percentage: totalCurrentValue > 0 ? (data.current / totalCurrentValue) * 100 : 0,
    }));

    const projectedAllocation = Object.entries(valuesByAssetClass).map(([id, data]) => ({
      id,
      name: data.name,
      color: data.color,
      value: data.projected,
      percentage: totalProjectedValue > 0 ? (data.projected / totalProjectedValue) * 100 : 0,
    }));

    res.json({
      orders,
      currentAllocation,
      projectedAllocation,
      totalCurrentValue,
      totalProjectedValue,
    });
  } catch (error) {
    console.error("Failed to calculate order impact:", error);
    res.status(500).json({ error: "Failed to calculate order impact" });
  }
});

// POST /api/orders/simulate - Simulate impact of hypothetical orders
router.post("/simulate", async (req: Request, res: Response) => {
  try {
    const { orders: simulatedOrders } = req.body;

    if (!Array.isArray(simulatedOrders)) {
      res.status(400).json({ error: "Orders array is required" });
      return;
    }

    const client = ibkrService.getClient();

    // Get current positions
    let rawPositions: any[] = [];
    if (client) {
      try {
        const result = await client.getPositions();
        rawPositions = Array.isArray(result) ? result : [];
      } catch (err: any) {
        if (!err.message?.includes("does not support positions") && err.code !== "timeout") {
          throw err;
        }
      }
    }

    // Get security assignments
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a])
    );

    // Calculate current values by asset class
    const valuesByAssetClass: Record<string, { name: string; color: string; current: number; projected: number }> = {};
    let totalCurrentValue = 0;

    for (const p of rawPositions) {
      const value = Math.abs(p.pos * p.avgCost);
      totalCurrentValue += value;

      const key = `${p.contract.symbol}:${p.contract.secType}`;
      const assignment = assignmentMap.get(key);

      if (assignment) {
        if (!valuesByAssetClass[assignment.assetClassId]) {
          valuesByAssetClass[assignment.assetClassId] = {
            name: assignment.assetClass.name,
            color: assignment.assetClass.color,
            current: 0,
            projected: 0,
          };
        }
        valuesByAssetClass[assignment.assetClassId].current += value;
        valuesByAssetClass[assignment.assetClassId].projected += value;
      }
    }

    // Apply simulated orders
    let totalProjectedValue = totalCurrentValue;
    for (const order of simulatedOrders) {
      const { symbol, secType = "STK", action, quantity, price } = order;
      const orderValue = quantity * price;

      const key = `${symbol.toUpperCase()}:${secType}`;
      const assignment = assignmentMap.get(key);

      if (assignment) {
        if (!valuesByAssetClass[assignment.assetClassId]) {
          valuesByAssetClass[assignment.assetClassId] = {
            name: assignment.assetClass.name,
            color: assignment.assetClass.color,
            current: 0,
            projected: 0,
          };
        }

        if (action === "BUY") {
          valuesByAssetClass[assignment.assetClassId].projected += orderValue;
          totalProjectedValue += orderValue;
        } else if (action === "SELL") {
          valuesByAssetClass[assignment.assetClassId].projected -= orderValue;
          totalProjectedValue -= orderValue;
        }
      }
    }

    // Build response
    const currentAllocation = Object.entries(valuesByAssetClass).map(([id, data]) => ({
      id,
      name: data.name,
      color: data.color,
      value: data.current,
      percentage: totalCurrentValue > 0 ? (data.current / totalCurrentValue) * 100 : 0,
    }));

    const projectedAllocation = Object.entries(valuesByAssetClass).map(([id, data]) => ({
      id,
      name: data.name,
      color: data.color,
      value: data.projected,
      percentage: totalProjectedValue > 0 ? (data.projected / totalProjectedValue) * 100 : 0,
    }));

    res.json({
      orders: simulatedOrders,
      currentAllocation,
      projectedAllocation,
      totalCurrentValue,
      totalProjectedValue,
    });
  } catch (error) {
    console.error("Failed to simulate order impact:", error);
    res.status(500).json({ error: "Failed to simulate order impact" });
  }
});

export default router;
