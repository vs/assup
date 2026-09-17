-- CreateTable
CREATE TABLE "iv_history_cache" (
    "symbol" VARCHAR(20) NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "iv_history_cache_pkey" PRIMARY KEY ("symbol")
);
