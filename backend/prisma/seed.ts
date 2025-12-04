import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Default asset classes based on CLAUDE.md allocation strategy
const defaultAssetClasses = [
  { name: "Bonds: US", color: "#3b82f6", description: "US Treasury and corporate bonds" },
  { name: "Stocks: Tech", color: "#8b5cf6", description: "Technology sector stocks" },
  { name: "Stocks: Nuclear", color: "#f59e0b", description: "Nuclear energy sector stocks" },
  { name: "Stocks: India", color: "#10b981", description: "Indian market stocks" },
  { name: "Stocks: US", color: "#6366f1", description: "US broad market stocks" },
  { name: "Stocks: ex-US", color: "#ec4899", description: "International stocks excluding US" },
  { name: "High Yield", color: "#ef4444", description: "High yield bonds and dividend stocks" },
  { name: "Metals", color: "#eab308", description: "Precious metals and mining" },
  { name: "Pick-up", color: "#14b8a6", description: "Opportunistic investments" },
  { name: "Cash", color: "#6b7280", description: "Cash and cash equivalents" },
];

// Default allocation targets matching CLAUDE.md
const defaultAllocationTargets: Record<string, number> = {
  "Bonds: US": 25,
  "Stocks: Tech": 20,
  "Stocks: Nuclear": 10,
  "Stocks: India": 10,
  "Stocks: US": 10,
  "Stocks: ex-US": 5,
  "High Yield": 5,
  "Metals": 5,
  "Pick-up": 5,
  "Cash": 5,
};

async function main() {
  console.log("Seeding database...");

  // Create asset classes
  const assetClasses: Record<string, string> = {};

  for (const ac of defaultAssetClasses) {
    const created = await prisma.assetClass.upsert({
      where: { name: ac.name },
      update: { color: ac.color, description: ac.description },
      create: ac,
    });
    assetClasses[ac.name] = created.id;
    console.log(`  Created/updated asset class: ${ac.name}`);
  }

  // Create default allocation profile
  const profile = await prisma.allocationProfile.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: { name: "Default Allocation", isActive: true },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Default Allocation",
      isActive: true,
    },
  });
  console.log(`  Created/updated allocation profile: ${profile.name}`);

  // Create allocation targets
  for (const [className, percentage] of Object.entries(defaultAllocationTargets)) {
    const assetClassId = assetClasses[className];
    if (!assetClassId) {
      console.warn(`  Warning: Asset class "${className}" not found, skipping target`);
      continue;
    }

    await prisma.allocationTarget.upsert({
      where: {
        allocationProfileId_assetClassId: {
          allocationProfileId: profile.id,
          assetClassId: assetClassId,
        },
      },
      update: { targetPercentage: percentage },
      create: {
        allocationProfileId: profile.id,
        assetClassId: assetClassId,
        targetPercentage: percentage,
      },
    });
    console.log(`  Set target for ${className}: ${percentage}%`);
  }

  // Create default dashboard settings
  await prisma.setting.upsert({
    where: { key: "dashboard" },
    update: {},
    create: {
      key: "dashboard",
      value: {
        includeOptions: false,
        optionsWeightMode: "notional",
      },
    },
  });
  console.log("  Created default dashboard settings");

  // Create a default watchlist
  await prisma.watchlist.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Main Watchlist",
    },
  });
  console.log("  Created default watchlist");

  console.log("Database seeding completed!");
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
