-- CreateTable
CREATE TABLE "wheel_strategies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_market_cap" DOUBLE PRECISION NOT NULL DEFAULT 5000000000,
    "csp_min_dte" INTEGER NOT NULL DEFAULT 25,
    "csp_max_dte" INTEGER NOT NULL DEFAULT 35,
    "csp_max_delta" DOUBLE PRECISION NOT NULL DEFAULT -0.34,
    "csp_min_roi" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "csp_max_roi" DOUBLE PRECISION NOT NULL DEFAULT 3.5,
    "cc_min_dte" INTEGER NOT NULL DEFAULT 5,
    "cc_max_dte" INTEGER NOT NULL DEFAULT 10,
    "cc_min_roi" DOUBLE PRECISION,
    "max_positions" INTEGER NOT NULL DEFAULT 10,
    "max_per_asset_class" INTEGER NOT NULL DEFAULT 2,
    "target_asset_classes" UUID[] DEFAULT ARRAY[]::UUID[],
    "accepted_recommendations" TEXT[] DEFAULT ARRAY['buy','wheel']::TEXT[],
    "min_research_confidence" DOUBLE PRECISION,
    "require_fresh_report" BOOLEAN NOT NULL DEFAULT true,
    "report_max_age_days" INTEGER NOT NULL DEFAULT 7,
    "interval_hours" DOUBLE PRECISION,
    "cron_expression" VARCHAR(100),
    "last_run_at" TIMESTAMPTZ,
    "next_run_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wheel_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wheel_strategy_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "strategy_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "phase" VARCHAR(30),
    "total_candidates" INTEGER NOT NULL DEFAULT 0,
    "processed_candidates" INTEGER NOT NULL DEFAULT 0,
    "csp_results" JSONB,
    "cc_results" JSONB,
    "skipped_tickers" JSONB,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_strategy_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wheel_strategy_scans_strategy_id_idx" ON "wheel_strategy_scans"("strategy_id");

-- CreateIndex
CREATE INDEX "wheel_strategy_scans_status_idx" ON "wheel_strategy_scans"("status");

-- AddForeignKey
ALTER TABLE "wheel_strategy_scans" ADD CONSTRAINT "wheel_strategy_scans_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "wheel_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
