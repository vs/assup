-- CreateTable
CREATE TABLE "scan_runs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "scan_code" VARCHAR(60) NOT NULL,
    "location_code" VARCHAR(40) NOT NULL DEFAULT 'STK.US.MAJOR',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "technical_filter" JSONB NOT NULL DEFAULT '{}',
    "symbols" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);
