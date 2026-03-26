-- AlterTable
ALTER TABLE "wheel_summary_cache" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "research_ticker" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "sec_type" VARCHAR(10) NOT NULL DEFAULT 'STK',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_analyzed" TIMESTAMPTZ,

    CONSTRAINT "research_ticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection" (
    "id" UUID NOT NULL,
    "ticker_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "collected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ok',
    "data" JSONB,
    "skip_reason" TEXT,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "data_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis" (
    "id" UUID NOT NULL,
    "ticker_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "analyzed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signal" VARCHAR(10) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_report" (
    "id" UUID NOT NULL,
    "ticker_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendation" VARCHAR(20) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "full_report" TEXT NOT NULL,
    "analysis_ids" UUID[],

    CONSTRAINT "research_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_job" (
    "id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "symbol" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "progress" TEXT,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "research_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_config" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "criteria" JSONB NOT NULL,
    "schedule" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run" TIMESTAMPTZ,

    CONSTRAINT "screener_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macro_snapshot" (
    "id" UUID NOT NULL,
    "analyzed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regime" VARCHAR(20) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "macro_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_ticker_symbol_key" ON "research_ticker"("symbol");

-- CreateIndex
CREATE INDEX "data_collection_ticker_id_source_idx" ON "data_collection"("ticker_id", "source");

-- CreateIndex
CREATE INDEX "data_collection_expires_at_idx" ON "data_collection"("expires_at");

-- CreateIndex
CREATE INDEX "analysis_ticker_id_source_idx" ON "analysis"("ticker_id", "source");

-- CreateIndex
CREATE INDEX "research_report_ticker_id_idx" ON "research_report"("ticker_id");

-- CreateIndex
CREATE INDEX "research_job_status_idx" ON "research_job"("status");

-- CreateIndex
CREATE INDEX "research_job_symbol_idx" ON "research_job"("symbol");

-- AddForeignKey
ALTER TABLE "data_collection" ADD CONSTRAINT "data_collection_ticker_id_fkey" FOREIGN KEY ("ticker_id") REFERENCES "research_ticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_ticker_id_fkey" FOREIGN KEY ("ticker_id") REFERENCES "research_ticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_report" ADD CONSTRAINT "research_report_ticker_id_fkey" FOREIGN KEY ("ticker_id") REFERENCES "research_ticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
