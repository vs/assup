-- AlterTable
ALTER TABLE "data_collection" ADD COLUMN "status" VARCHAR(10) NOT NULL DEFAULT 'ok';
ALTER TABLE "data_collection" ADD COLUMN "skip_reason" TEXT;
ALTER TABLE "data_collection" ALTER COLUMN "data" DROP NOT NULL;
