-- Lot 5a : demande de devis annulée, par qui et quand (affiché sur la carte de la demande).
ALTER TABLE "Rfq" ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancelledById" TEXT;
