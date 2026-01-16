-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "record_count" INTEGER NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_trades" (
    "id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "trade_id" VARCHAR(50) NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "con_id" INTEGER,
    "sec_type" VARCHAR(10) NOT NULL,
    "strike" DOUBLE PRECISION,
    "expiry" DATE,
    "right" VARCHAR(1),
    "underlying" VARCHAR(20),
    "multiplier" INTEGER NOT NULL DEFAULT 100,
    "trade_date" DATE NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "trade_price" DOUBLE PRECISION NOT NULL,
    "proceeds" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buy_sell" VARCHAR(10) NOT NULL,
    "open_close" VARCHAR(10),
    "was_assigned" BOOLEAN NOT NULL DEFAULT false,
    "assignment_date" DATE,

    CONSTRAINT "imported_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "transaction_id" VARCHAR(50) NOT NULL,
    "symbol" VARCHAR(20),
    "description" TEXT NOT NULL,
    "con_id" INTEGER,
    "transaction_date" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "type" VARCHAR(30) NOT NULL,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imported_trades_trade_id_key" ON "imported_trades"("trade_id");

-- CreateIndex
CREATE INDEX "imported_trades_symbol_idx" ON "imported_trades"("symbol");

-- CreateIndex
CREATE INDEX "imported_trades_trade_date_idx" ON "imported_trades"("trade_date");

-- CreateIndex
CREATE INDEX "imported_trades_expiry_idx" ON "imported_trades"("expiry");

-- CreateIndex
CREATE INDEX "imported_trades_sec_type_idx" ON "imported_trades"("sec_type");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_transaction_id_key" ON "cash_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "cash_transactions_type_idx" ON "cash_transactions"("type");

-- CreateIndex
CREATE INDEX "cash_transactions_transaction_date_idx" ON "cash_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "cash_transactions_symbol_idx" ON "cash_transactions"("symbol");

-- AddForeignKey
ALTER TABLE "imported_trades" ADD CONSTRAINT "imported_trades_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
