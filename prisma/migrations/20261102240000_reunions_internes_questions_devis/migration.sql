-- Réunions internes : ni publication ni inscriptions.
ALTER TABLE "Event" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;

-- Questions et échanges sur une demande de devis (fil privé par prestataire consulté).
CREATE TABLE "RfqMessage" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "fromSupplier" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfqMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RfqMessage_rfqId_supplierId_idx" ON "RfqMessage"("rfqId", "supplierId");

ALTER TABLE "RfqMessage" ADD CONSTRAINT "RfqMessage_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RfqMessage" ADD CONSTRAINT "RfqMessage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfqMessage" ADD CONSTRAINT "RfqMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
