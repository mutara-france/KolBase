-- Devis détaillés : lignes, TVA, validité, conditions, PDF joint, numéro de révision.
ALTER TABLE "Quote" ADD COLUMN "lines" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "vatBp" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN "validUntil" TIMESTAMP(3),
ADD COLUMN "conditions" TEXT,
ADD COLUMN "fileKey" TEXT,
ADD COLUMN "fileName" TEXT,
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
