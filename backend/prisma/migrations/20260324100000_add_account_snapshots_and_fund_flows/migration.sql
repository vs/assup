-- CreateTable
CREATE TABLE "account_snapshots" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "net_liquidation" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
    "import_batch_id" UUID NOT NULL,

    CONSTRAINT "account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_flows" (
    "id" UUID NOT NULL,
    "transaction_id" VARCHAR(255) NOT NULL,
    "date" DATE NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
    "description" TEXT NOT NULL,
    "import_batch_id" UUID NOT NULL,

    CONSTRAINT "fund_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_snapshots_date_key" ON "account_snapshots"("date");

-- CreateIndex
CREATE INDEX "account_snapshots_date_idx" ON "account_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "fund_flows_transaction_id_key" ON "fund_flows"("transaction_id");

-- CreateIndex
CREATE INDEX "fund_flows_date_idx" ON "fund_flows"("date");

-- CreateIndex
CREATE INDEX "fund_flows_type_idx" ON "fund_flows"("type");

-- AddForeignKey
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_flows" ADD CONSTRAINT "fund_flows_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
