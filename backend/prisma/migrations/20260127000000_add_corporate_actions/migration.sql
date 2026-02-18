-- CreateTable
CREATE TABLE "corporate_actions" (
    "id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "action_id" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "con_id" INTEGER,
    "action_type" VARCHAR(20) NOT NULL,
    "ex_date" DATE NOT NULL,
    "pay_date" DATE,
    "quantity" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "split_ratio" DOUBLE PRECISION,

    CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corporate_actions_action_id_key" ON "corporate_actions"("action_id");

-- CreateIndex
CREATE INDEX "corporate_actions_symbol_idx" ON "corporate_actions"("symbol");

-- CreateIndex
CREATE INDEX "corporate_actions_ex_date_idx" ON "corporate_actions"("ex_date");

-- CreateIndex
CREATE INDEX "corporate_actions_action_type_idx" ON "corporate_actions"("action_type");

-- AddForeignKey
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
