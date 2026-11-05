-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "campaignNo" TEXT,
    "orderId" TEXT,
    "productName" TEXT,
    "quantity" INTEGER,
    "status" INTEGER NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "commissionVnd" INTEGER NOT NULL,
    "orderValueVnd" INTEGER NOT NULL,
    "reasonRejected" TEXT,
    "utmSource" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "clickReferer" TEXT,
    "clickTime" TIMESTAMP(3),
    "transactionTime" TIMESTAMP(3) NOT NULL,
    "atUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversion_utmContent_idx" ON "Conversion"("utmContent");

-- CreateIndex
CREATE INDEX "Conversion_transactionTime_idx" ON "Conversion"("transactionTime");

