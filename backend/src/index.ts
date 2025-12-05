import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { ibkrService } from "./services/ibkr.js";
import { prisma } from "./db/index.js";
import assetClassesRouter from "./routes/assetClasses.js";
import allocationProfilesRouter from "./routes/allocationProfiles.js";
import positionsRouter from "./routes/positions.js";
import securityAssignmentsRouter from "./routes/securityAssignments.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/asset-classes", assetClassesRouter);
app.use("/api/allocation-profiles", allocationProfilesRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/security-assignments", securityAssignmentsRouter);

app.get("/api/health", async (req, res) => {
  try {
    // Test database connection
    const assetClassCount = await prisma.assetClass.count();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: { connected: true, assetClasses: assetClassCount },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: { connected: false, error: String(error) },
    });
  }
});

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
