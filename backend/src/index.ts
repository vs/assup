import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
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
import wheelStrategyRouter from "./routes/wheelStrategy.js";
import researchRouter from "./routes/research.js";
import wheelScannerRouter from "./routes/wheelScanner.js";
import tickerProfileRouter from "./routes/tickerProfile.js";
import { scanJobService } from "./services/scanJob.service.js";
import { initCollectors } from "./services/research/collectors/index.js";
import { initAnalyzers } from "./services/research/analyzers/index.js";
import { schedulerService } from "./services/research/scheduler.service.js";
import { wheelStrategyScheduler } from "./services/wheelStrategy.scheduler.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS with allowed origins for security
// In production, set FRONTEND_URL environment variable to the actual frontend URL
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:8080",
  "http://localhost:8081", // Live trading frontend
  "http://localhost:5173", // Vite dev server
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

// Rate limiting for general API requests
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for order placement to prevent accidental mass orders
const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 order placements per minute
  message: { error: "Too many order requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(generalLimiter as any);
app.use(express.json());

// API Routes
app.use("/api/asset-classes", assetClassesRouter);
app.use("/api/allocation-profiles", allocationProfilesRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/security-assignments", securityAssignmentsRouter);
app.use("/api/watchlists", watchlistsRouter);
// Apply stricter rate limiting for order placement endpoint
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use("/api/orders/place", orderLimiter as any);
app.use("/api/orders", ordersRouter);
app.use("/api/scanner/jobs", scannerJobsRouter);
app.use("/api/scanner", scannerRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/historical", historicalDataRouter);
app.use("/api/profit", profitRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/taxes", taxesRouter);
app.use("/api/wheel", wheelRouter);
app.use("/api/wheel-strategy", wheelStrategyRouter);
app.use("/api/research", researchRouter);
app.use("/api/wheel-scanner", wheelScannerRouter);
app.use("/api/ticker-profile", tickerProfileRouter);

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

  // Send initial connection message with current IBKR status
  res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "connection", data: ibkrService.getStatus() })}\n\n`);

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

// Initialize research subsystem
initCollectors();
initAnalyzers();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  scanJobService.init();

  // Start research scheduler if enabled
  if (process.env.SCHEDULER_ENABLED === "true") {
    schedulerService.start();
    console.log("Research scheduler started");
  }

  wheelStrategyScheduler.start().catch((err) => {
    console.error("Failed to start wheel strategy scheduler:", err);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  schedulerService.stop();
  wheelStrategyScheduler.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  schedulerService.stop();
  wheelStrategyScheduler.stop();
  process.exit(0);
});
