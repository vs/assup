import express from "express";
import { errorHandler } from "../../../middleware/errorHandler.js";

export function createTestApp(...routers: Array<{ path: string; router: express.Router }>) {
  const app = express();
  app.use(express.json());
  for (const { path, router } of routers) {
    app.use(path, router);
  }
  app.use(errorHandler);
  return app;
}
