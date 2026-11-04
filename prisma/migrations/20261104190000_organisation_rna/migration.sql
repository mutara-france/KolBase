-- Lot 4 : numéro RNA des associations et sociétés savantes sans SIREN ; date de la dernière demande de validation.
ALTER TABLE "Organization" ADD COLUMN "rna" TEXT;
ALTER TABLE "Organization" ADD COLUMN "verificationRequestedAt" TIMESTAMP(3);

-- Reprise : les organisations en attente ont transmis leur demande à leur création (ou à leur dernière mise à jour).
UPDATE "Organization" SET "verificationRequestedAt" = COALESCE("sirenCheckedAt", "createdAt") WHERE "verification" = 'PENDING';
