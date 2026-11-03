-- Bilan des services KolBase : lien suivi, clics, inscriptions attribuées, bilan envoyé.
ALTER TABLE "ServiceOrder" ADD COLUMN "trackCode" TEXT, ADD COLUMN "reportSentAt" TIMESTAMP(3);
UPDATE "ServiceOrder" SET "trackCode" = substr(md5(random()::text || id), 1, 10) WHERE "trackCode" IS NULL;
CREATE UNIQUE INDEX "ServiceOrder_trackCode_key" ON "ServiceOrder"("trackCode");

ALTER TABLE "Registration" ADD COLUMN "sourceOrderId" TEXT;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ServiceClick" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceClick_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceClick_orderId_idx" ON "ServiceClick"("orderId");
ALTER TABLE "ServiceClick" ADD CONSTRAINT "ServiceClick_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
