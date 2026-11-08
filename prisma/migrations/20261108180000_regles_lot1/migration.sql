-- Lot 1 (règles) : praticien agent public et autorisation de cumul, visa Mdeon des événements (Belgique).
ALTER TABLE "PractitionerProfile" ADD COLUMN "publicAgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "DocumentKind" ADD VALUE 'AUTORISATION_CUMUL';
ALTER TABLE "Event" ADD COLUMN "mdeonVisa" TEXT, ADD COLUMN "mdeonVisaAt" TIMESTAMP(3);
