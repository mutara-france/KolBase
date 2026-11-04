-- Mandat d'agence : droit de retenir un devis au nom de l'organisation (non par défaut).
ALTER TABLE "Mandate" ADD COLUMN "canAward" BOOLEAN NOT NULL DEFAULT false;
-- Devis proposé par une agence sans ce droit : l'organisateur le retient (ou en retient un autre).
ALTER TABLE "Rfq" ADD COLUMN "proposedQuoteId" TEXT, ADD COLUMN "proposedById" TEXT, ADD COLUMN "proposedAt" TIMESTAMP(3);
