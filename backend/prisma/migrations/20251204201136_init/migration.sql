-- CreateTable
CREATE TABLE "asset_classes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "asset_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_profiles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "allocation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_targets" (
    "id" UUID NOT NULL,
    "allocation_profile_id" UUID NOT NULL,
    "asset_class_id" UUID NOT NULL,
    "target_percentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "allocation_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_assignments" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "con_id" INTEGER,
    "sec_type" VARCHAR(10) NOT NULL DEFAULT 'STK',
    "asset_class_id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'position',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "security_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL,
    "watchlist_id" UUID NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "con_id" INTEGER,
    "sec_type" VARCHAR(10) NOT NULL DEFAULT 'STK',
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_presets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "criteria" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scanner_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_classes_name_key" ON "asset_classes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_targets_allocation_profile_id_asset_class_id_key" ON "allocation_targets"("allocation_profile_id", "asset_class_id");

-- CreateIndex
CREATE INDEX "security_assignments_symbol_idx" ON "security_assignments"("symbol");

-- CreateIndex
CREATE INDEX "security_assignments_asset_class_id_idx" ON "security_assignments"("asset_class_id");

-- CreateIndex
CREATE UNIQUE INDEX "security_assignments_symbol_sec_type_key" ON "security_assignments"("symbol", "sec_type");

-- CreateIndex
CREATE INDEX "watchlist_items_watchlist_id_idx" ON "watchlist_items"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_watchlist_id_symbol_key" ON "watchlist_items"("watchlist_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- AddForeignKey
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_allocation_profile_id_fkey" FOREIGN KEY ("allocation_profile_id") REFERENCES "allocation_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_asset_class_id_fkey" FOREIGN KEY ("asset_class_id") REFERENCES "asset_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_assignments" ADD CONSTRAINT "security_assignments_asset_class_id_fkey" FOREIGN KEY ("asset_class_id") REFERENCES "asset_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
