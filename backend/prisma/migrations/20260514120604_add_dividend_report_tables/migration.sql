-- CreateTable
CREATE TABLE "dividend_report_uploads" (
    "id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_hash" VARCHAR(64) NOT NULL,
    "account_number" VARCHAR(50),
    "tax_year" INTEGER NOT NULL,
    "record_count" INTEGER NOT NULL,

    CONSTRAINT "dividend_report_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_report_records" (
    "id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "symbol" VARCHAR(50) NOT NULL,
    "con_id" INTEGER,
    "country" VARCHAR(2),
    "pay_date" DATE NOT NULL,
    "ex_date" DATE,
    "shares" DOUBLE PRECISION,
    "revenue_component" VARCHAR(120) NOT NULL,
    "qualified_indicator" VARCHAR(80),
    "tax_category" VARCHAR(20) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "gross_usd" DOUBLE PRECISION NOT NULL,
    "withhold_usd" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "dividend_report_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dividend_report_uploads_file_hash_idx" ON "dividend_report_uploads"("file_hash");

-- CreateIndex
CREATE INDEX "dividend_report_uploads_tax_year_idx" ON "dividend_report_uploads"("tax_year");

-- CreateIndex
CREATE INDEX "dividend_report_records_symbol_pay_date_idx" ON "dividend_report_records"("symbol", "pay_date");

-- CreateIndex
CREATE INDEX "dividend_report_records_pay_date_idx" ON "dividend_report_records"("pay_date");

-- AddForeignKey
ALTER TABLE "dividend_report_records" ADD CONSTRAINT "dividend_report_records_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "dividend_report_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
