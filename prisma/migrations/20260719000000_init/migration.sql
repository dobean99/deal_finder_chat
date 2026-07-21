-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "originalPrice" INTEGER,
    "image" TEXT,
    "category" TEXT,
    "affLink" TEXT NOT NULL,
    "salesRank" INTEGER,
    "rating" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "code" TEXT,
    "affLink" TEXT NOT NULL,
    "endTime" TIMESTAMP(3),
    "productId" TEXT,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "campaign" TEXT,
    "ipHash" TEXT,
    "ua" TEXT,
    "isWebview" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_merchant_category_idx" ON "Product"("merchant", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchant_productId_key" ON "Product"("merchant", "productId");

-- CreateIndex
CREATE INDEX "Voucher_merchant_endTime_idx" ON "Voucher"("merchant", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "ClickEvent_clickId_key" ON "ClickEvent"("clickId");

-- CreateIndex
CREATE INDEX "ClickEvent_productId_createdAt_idx" ON "ClickEvent"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

