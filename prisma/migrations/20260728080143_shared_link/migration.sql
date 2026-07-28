-- CreateTable
CREATE TABLE "SharedLink" (
    "id" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedLink_merchant_targetUrl_key" ON "SharedLink"("merchant", "targetUrl");
