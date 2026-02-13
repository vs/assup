-- CreateTable
CREATE TABLE "wheel_trackers" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "start_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wheel_suggestion_dismissals" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "dismissed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_suggestion_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wheel_trackers_symbol_key" ON "wheel_trackers"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "wheel_suggestion_dismissals_symbol_key" ON "wheel_suggestion_dismissals"("symbol");
