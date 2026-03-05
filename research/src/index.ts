import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { prisma } from "./db/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import tickersRouter from "./routes/tickers.js";
import reportsRouter from "./routes/reports.js";
import analysisRouter from "./routes/analysis.js";
import jobsRouter from "./routes/jobs.js";
import { initCollectors } from "./collectors/index.js";
import { initAnalyzers } from "./analyzers/index.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3002", 10);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(limiter as any);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

// Initialize collectors and analyzers
initCollectors();
initAnalyzers();

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    const tickerCount = await prisma.ticker.count();
    res.json({
      status: "ok",
      database: "connected",
      tickers: tickerCount,
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// Routes
app.use("/api/tickers", tickersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/analysis", analysisRouter);
app.use("/api/jobs", jobsRouter);

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Research service running on port ${PORT}`);
});
