import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { ibkrService } from "./services/ibkr.js";
import { sseService } from "./services/sse.js";
import { prisma } from "./db/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import assetClassesRouter from "./routes/assetClasses.js";
import allocationProfilesRouter from "./routes/allocationProfiles.js";
import positionsRouter from "./routes/positions.js";
import securityAssignmentsRouter from "./routes/securityAssignments.js";
import watchlistsRouter from "./routes/watchlists.js";
import ordersRouter from "./routes/orders.js";
import scannerJobsRouter from "./routes/scannerJobs.js";
import scannerRouter from "./routes/scanner.js";
import settingsRouter from "./routes/settings.js";
import historicalDataRouter from "./routes/historicalData.js";
import profitRouter from "./routes/profit.js";
import exchangeRatesRouter from "./routes/exchangeRates.js";
import taxesRouter from "./routes/taxes.js";
import wheelRouter from "./routes/wheel.js";
import { scanJobService } from "./services/scanJob.service.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/asset-classes", assetClassesRouter);
app.use("/api/allocation-profiles", allocationProfilesRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/security-assignments", securityAssignmentsRouter);
app.use("/api/watchlists", watchlistsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/scanner/jobs", scannerJobsRouter);
app.use("/api/scanner", scannerRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/historical", historicalDataRouter);
app.use("/api/profit", profitRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/taxes", taxesRouter);
app.use("/api/wheel", wheelRouter);

app.get("/api/health", asyncHandler(async (req, res) => {
  const assetClassCount = await prisma.assetClass.count();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: { connected: true, assetClasses: assetClassCount },
  });
}));

// SSE endpoint for TWS connection status
app.get("/api/connection/status", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial status
  const sendStatus = (status: ReturnType<typeof ibkrService.getStatus>) => {
    res.write(`data: ${JSON.stringify(status)}\n\n`);
  };

  // Subscribe to status updates
  const unsubscribe = ibkrService.subscribe(sendStatus);

  // Send keepalive every 30 seconds
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  // Cleanup on client disconnect
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

// REST endpoint to get current status (for initial load)
app.get("/api/connection/status/current", (req, res) => {
  res.json(ibkrService.getStatus());
});

// SSE endpoint for real-time updates (positions, orders, allocation changes)
app.get("/api/updates/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Register client
  const clientId = sseService.addClient(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

  // Send keepalive every 30 seconds
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  // Subscribe to IBKR connection status changes
  const unsubscribe = ibkrService.subscribe((status) => {
    sseService.sendToClient(clientId, "connection", status);
  });

  // Cleanup on client disconnect
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
    sseService.removeClient(clientId);
  });
});

// Endpoint to trigger a position refresh broadcast (called after data changes)
app.post("/api/updates/refresh", async (req: Request, res: Response) => {
  try {
    const { type } = req.body;
    if (type === "positions" || type === "all") {
      sseService.broadcast("position", { refreshed: true });
    }
    if (type === "orders" || type === "all") {
      sseService.broadcast("order", { refreshed: true });
    }
    if (type === "allocation" || type === "all") {
      sseService.broadcast("allocation", { refreshed: true });
    }
    res.json({ success: true, clients: sseService.getClientCount() });
  } catch (error) {
    res.status(500).json({ error: "Failed to broadcast refresh" });
  }
});

// Global error handler - must be last middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  scanJobService.init();
});
