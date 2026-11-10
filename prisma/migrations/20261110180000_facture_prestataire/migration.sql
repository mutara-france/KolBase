-- Facture du prestataire retenu, rapprochée du devis, et son paiement.
ALTER TABLE "Quote" ADD COLUMN "invoiceKey" TEXT,
ADD COLUMN "invoiceName" TEXT,
ADD COLUMN "invoiceCents" INTEGER,
ADD COLUMN "invoicedAt" TIMESTAMP(3),
ADD COLUMN "invoicePaidAt" TIMESTAMP(3);
