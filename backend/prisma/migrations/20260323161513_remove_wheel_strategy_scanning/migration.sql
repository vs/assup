-- DropForeignKey
ALTER TABLE "wheel_scan_configs" DROP CONSTRAINT "wheel_scan_configs_asset_class_id_fkey";

-- DropForeignKey
ALTER TABLE "wheel_scan_results" DROP CONSTRAINT "wheel_scan_results_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "wheel_strategy_scans" DROP CONSTRAINT "wheel_strategy_scans_strategy_id_fkey";

-- DropTable
DROP TABLE "wheel_scan_configs";

-- DropTable
DROP TABLE "wheel_scan_results";

-- DropTable
DROP TABLE "wheel_scans";

-- DropTable
DROP TABLE "wheel_strategies";

-- DropTable
DROP TABLE "wheel_strategy_scans";
