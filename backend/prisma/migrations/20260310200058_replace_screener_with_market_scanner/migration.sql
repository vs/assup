/*
  Warnings:

  - You are about to drop the `screener_config` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "screener_config";

-- CreateTable
CREATE TABLE "market_scanner_preset" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "scan_code" VARCHAR(60) NOT NULL,
    "location_code" VARCHAR(40) NOT NULL DEFAULT 'STK.US.MAJOR',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "technical_filter" JSONB NOT NULL DEFAULT '{}',
    "schedule" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run" TIMESTAMPTZ,

    CONSTRAINT "market_scanner_preset_pkey" PRIMARY KEY ("id")
);
