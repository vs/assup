/**
 * 404 Not Found handler for unknown routes
 */

import { Request, Response } from "express";

/**
 * Handler for routes that don't exist
 * Should be added after all other routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
  });
}
