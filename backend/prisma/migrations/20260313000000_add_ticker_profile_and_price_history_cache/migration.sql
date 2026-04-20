-- CreateTable
CREATE TABLE "ticker_profile" (
    "symbol" VARCHAR(20) NOT NULL,
    "company_name" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "sector" VARCHAR(100),
    "industry" VARCHAR(255),
    "market_position" VARCHAR(100),
    "market_cap" DOUBLE PRECISION,
    "pe_ratio" DOUBLE PRECISION,
    "dividend_yield" DOUBLE PRECISION,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ticker_profile_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "price_history_cache" (
    "symbol" VARCHAR(20) NOT NULL,
    "data" JSONB NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "price_history_cache_pkey" PRIMARY KEY ("symbol")
);
