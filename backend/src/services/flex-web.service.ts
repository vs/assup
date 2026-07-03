import { XMLParser } from "fast-xml-parser";
import { prisma } from "../db/index.js";
import { importService } from "./import.service.js";
import type { FlexFetchResult } from "@assup/shared";

const FLEX_BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService";

export class FlexWebService {
  private fetching = false;
  private parser = new XMLParser();

  async getConfig() {
    const keys = ["flex.token", "flex.queryId", "flex.schedule", "flex.enabled"];
    const settings = await prisma.setting.findMany({
      where: { key: { in: keys } },
    });
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    return {
      token: (map["flex.token"] as string) || "",
      queryId: (map["flex.queryId"] as string) || "",
      schedule: (map["flex.schedule"] as string) || "0 6 * * 2-6",
      enabled: (map["flex.enabled"] as boolean) || false,
    };
  }

  async updateConfig(config: {
    token?: string;
    queryId?: string;
    schedule?: string;
    enabled?: boolean;
  }) {
    const entries = Object.entries(config)
      // Skip masked token — don't overwrite the real value
      .filter(([k, v]) => !(k === "token" && typeof v === "string" && v.startsWith("••••")))
      .map(([k, v]) => ({
        key: `flex.${k}`,
        value: v,
      }));
    for (const { key, value } of entries) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: value as any },
        create: { key, value: value as any },
      });
    }
  }

  async fetchAndImport(triggeredBy: "schedule" | "manual"): Promise<FlexFetchResult> {
    if (this.fetching) {
      return { status: "error", error: "A fetch is already in progress" };
    }
    this.fetching = true;

    const log = await prisma.flexFetchLog.create({
      data: {
        triggeredBy,
        status: "error", // default, updated on completion
        startedAt: new Date(),
      },
    });

    try {
      const config = await this.getConfig();
      if (!config.token || !config.queryId) {
        throw new Error("FLEX Web Service token and query ID must be configured");
      }

      // Step 1: Request the report
      const referenceCode = await this.requestReport(config.token, config.queryId);

      // Step 2: Poll for the report
      const reportContent = await this.pollForReport(config.token, referenceCode);

      // Step 3: Import via existing pipeline
      const filename = `flex-web-${new Date().toISOString().split("T")[0]}.xml`;
      const result = await importService.importFlexQuery(reportContent, filename);

      const status = result.duplicate ? "no_new_data" : "success";
      const details = result.stats;
      const { tradesSkipped, ...importedStats } = result.stats;
      const recordCount = result.duplicate
        ? 0
        : Object.values(importedStats).reduce((a, b) => a + b, 0);

      await prisma.flexFetchLog.update({
        where: { id: log.id },
        data: {
          status,
          completedAt: new Date(),
          recordCount,
          importBatchId: result.duplicate ? null : result.batchId,
          details: details as any,
        },
      });

      return { status, recordCount, details: details as any };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.flexFetchLog.update({
        where: { id: log.id },
        data: {
          status: "error",
          completedAt: new Date(),
          error,
        },
      });
      return { status: "error", error };
    } finally {
      this.fetching = false;
    }
  }

  private async requestReport(token: string, queryId: string): Promise<string> {
    const url = `${FLEX_BASE}.SendRequest?t=${token}&q=${queryId}&v=3`;
    const response = await fetch(url);
    const text = await response.text();
    const parsed = this.parser.parse(text);

    const root = parsed.FlexStatementResponse || parsed;
    if (root.Status === "Success" || root.Status === "Warn") {
      return String(root.ReferenceCode);
    }

    const errorCode = root.ErrorCode || "unknown";
    const errorMessage = root.ErrorMessage || "Unknown error from IBKR";
    throw new Error(`IBKR FLEX request failed (${errorCode}): ${errorMessage}`);
  }

  private async pollForReport(token: string, referenceCode: string): Promise<string> {
    const maxAttempts = 8; // ~2 minutes with exponential backoff
    let delay = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delay));

      const url = `${FLEX_BASE}.GetStatement?t=${token}&q=${referenceCode}&v=3`;
      const response = await fetch(url);
      const text = await response.text();

      console.log(`[FLEX] Poll attempt ${attempt + 1}/${maxAttempts} (${delay}ms delay), response length: ${text.length}`);

      // If the response is a proper FLEX report, return it.
      if (text.includes("<FlexQueryResponse") || text.includes("<FlexStatements")) {
        return text;
      }

      const parsed = this.parser.parse(text);
      const root = parsed.FlexStatementResponse || parsed;
      console.log(`[FLEX] Poll status: ErrorCode=${root.ErrorCode}, Status=${root.Status}`);

      if (String(root.ErrorCode) === "1019") {
        // Statement generation in progress, retry
        delay = Math.min(delay * 2, 16000);
        continue;
      }

      if (root.ErrorCode) {
        throw new Error(
          `IBKR FLEX poll failed (${root.ErrorCode}): ${root.ErrorMessage || "Unknown error"}`
        );
      }

      // If we got here with no error code and no report, retry
      delay = Math.min(delay * 2, 16000);
    }

    throw new Error("FLEX report generation timed out after ~2 minutes");
  }

  async getLogs(page: number, limit: number) {
    const [logs, total] = await Promise.all([
      prisma.flexFetchLog.findMany({
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.flexFetchLog.count(),
    ]);
    return { logs, total };
  }
}

export const flexWebService = new FlexWebService();
