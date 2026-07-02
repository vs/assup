-- CreateTable
CREATE TABLE "calendar_event" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "symbol" VARCHAR(20),
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB,
    "source" VARCHAR(20) NOT NULL,
    "source_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync_status" (
    "id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "symbol" VARCHAR(20),
    "last_sync_at" TIMESTAMPTZ NOT NULL,
    "next_sync_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "calendar_sync_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_source_source_id_key" ON "calendar_event"("source", "source_id");

-- CreateIndex
CREATE INDEX "calendar_event_date_idx" ON "calendar_event"("date");

-- CreateIndex
CREATE INDEX "calendar_event_symbol_date_idx" ON "calendar_event"("symbol", "date");

-- CreateIndex
CREATE INDEX "calendar_event_event_type_date_idx" ON "calendar_event"("event_type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sync_status_source_symbol_key" ON "calendar_sync_status"("source", "symbol");
