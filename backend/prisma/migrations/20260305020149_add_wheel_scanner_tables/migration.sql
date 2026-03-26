-- CreateTable
CREATE TABLE "wheel_scan_configs" (
    "id" UUID NOT NULL,
    "asset_class_id" UUID NOT NULL,
    "search_keywords" TEXT[],
    "seed_tickers" TEXT[],
    "min_price" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "max_price" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "min_market_cap" DOUBLE PRECISION NOT NULL DEFAULT 2000000000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wheel_scan_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wheel_scans" (
    "id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "total_candidates" INTEGER NOT NULL DEFAULT 0,
    "scored_candidates" INTEGER NOT NULL DEFAULT 0,
    "reports_triggered" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wheel_scan_results" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "asset_class_id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "composite_score" DOUBLE PRECISION NOT NULL,
    "iv_rank" DOUBLE PRECISION,
    "put_liquidity" DOUBLE PRECISION,
    "premium_yield" DOUBLE PRECISION,
    "market_cap" DOUBLE PRECISION,
    "last_price" DOUBLE PRECISION,
    "allocation_need" DOUBLE PRECISION,
    "report_triggered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wheel_scan_configs_asset_class_id_key" ON "wheel_scan_configs"("asset_class_id");

-- CreateIndex
CREATE INDEX "wheel_scans_status_idx" ON "wheel_scans"("status");

-- CreateIndex
CREATE INDEX "wheel_scan_results_scan_id_idx" ON "wheel_scan_results"("scan_id");

-- CreateIndex
CREATE INDEX "wheel_scan_results_composite_score_idx" ON "wheel_scan_results"("composite_score");

-- AddForeignKey
ALTER TABLE "wheel_scan_configs" ADD CONSTRAINT "wheel_scan_configs_asset_class_id_fkey" FOREIGN KEY ("asset_class_id") REFERENCES "asset_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wheel_scan_results" ADD CONSTRAINT "wheel_scan_results_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "wheel_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
