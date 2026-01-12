/**
 * Validation middleware using Zod schemas
 */

import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Creates middleware that validates request body, query, and/or params using Zod schemas
 *
 * @example
 * router.post("/",
 *   validate({ body: createAssetClassSchema }),
 *   asyncHandler(async (req, res) => {
 *     // req.body is now typed and validated
 *     const assetClass = await createAssetClass(req.body);
 *     res.json(assetClass);
 *   })
 * );
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (err) {
      // Let the error handler deal with ZodErrors
      next(err);
    }
  };
}

/**
 * Formats a ZodError into a user-friendly error response
 */
export function formatZodError(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }

  return formatted;
}
