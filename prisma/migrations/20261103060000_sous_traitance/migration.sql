-- Contrat de sous-traitance (RGPD) accepté au nom de chaque organisation.
ALTER TABLE "Organization" ADD COLUMN "dpaVersion" TEXT;
ALTER TABLE "Organization" ADD COLUMN "dpaAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "dpaAcceptedById" TEXT;
