-- CreateTable
CREATE TABLE "wheel_summary_cache" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "start_date" DATE,
    "trade_count" INTEGER NOT NULL,
    "last_trade_date" DATE,
    "summary" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_summary_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wheel_summary_cache_symbol_key" ON "wheel_summary_cache"("symbol");
