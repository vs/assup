import { Router, Request, Response } from "express";
import { historicalDataService } from "../services/historicalData.js";

const router = Router();

// GET /api/historical/sparkline/:symbol - Get sparkline data for a single symbol
router.get("/sparkline/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!symbol || symbol.length === 0) {
      res.status(400).json({ error: "Symbol is required" });
      return;
    }

    const data = await historicalDataService.getSparklineData(symbol);
    res.json({ symbol: symbol.toUpperCase(), data });
  } catch (error) {
    console.error("Failed to fetch sparkline data:", error);
    res.status(500).json({ error: "Failed to fetch sparkline data" });
  }
});

// POST /api/historical/sparklines - Get sparkline data for multiple symbols
router.post("/sparklines", async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      res.status(400).json({ error: "Symbols array is required" });
      return;
    }

    // Limit to 50 symbols per request
    const limitedSymbols = symbols.slice(0, 50);
    const results = await historicalDataService.getBatchSparklineData(
      limitedSymbols
    );

    // Convert Map to object for JSON response
    const response: Record<string, { date: string; close: number }[]> = {};
    results.forEach((data, symbol) => {
      response[symbol] = data;
    });

    res.json(response);
  } catch (error) {
    console.error("Failed to fetch batch sparkline data:", error);
    res.status(500).json({ error: "Failed to fetch sparkline data" });
  }
});

// GET /api/historical/cache/stats - Get cache statistics
router.get("/cache/stats", (req: Request, res: Response) => {
  res.json(historicalDataService.getCacheStats());
});

export default router;
