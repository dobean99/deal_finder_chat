-- Re-key Conversion on AccessTrade's per-line conversion_id. The rows synced
-- under the previous migration were keyed on the order-level `id`, which
-- collapsed multi-line orders; they are a pure cache of AccessTrade data and
-- the next `conversions` sync repopulates them.
DELETE FROM "Conversion";

-- AlterTable
ALTER TABLE "Conversion" ADD COLUMN "atOrderKey" TEXT NOT NULL,
ADD COLUMN "isBrandBonus" BOOLEAN NOT NULL DEFAULT false;
