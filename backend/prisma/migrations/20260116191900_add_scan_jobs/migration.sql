-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" UUID NOT NULL,
    "preset_id" UUID,
    "preset_name" VARCHAR(100) NOT NULL,
    "criteria" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "total_symbols" INTEGER NOT NULL DEFAULT 0,
    "scanned_symbols" INTEGER NOT NULL DEFAULT 0,
    "opportunity_count" INTEGER NOT NULL DEFAULT 0,
    "best_annual_return" DOUBLE PRECISION,
    "best_premium_pct" DOUBLE PRECISION,
    "opportunities" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "error_message" TEXT,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_jobs_status_idx" ON "scan_jobs"("status");

-- CreateIndex
CREATE INDEX "scan_jobs_expires_at_idx" ON "scan_jobs"("expires_at");
