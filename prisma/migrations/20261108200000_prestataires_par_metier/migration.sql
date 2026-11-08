-- Lot 3 (prestataires par métier) : questions de la demande, dates de la prestation, nombre définitif, conditions.
ALTER TABLE "Rfq" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "serviceStart" TIMESTAMP(3), ADD COLUMN "serviceEnd" TIMESTAMP(3),
  ADD COLUMN "finalHeadcount" INTEGER, ADD COLUMN "finalHeadcountAt" TIMESTAMP(3), ADD COLUMN "finalHeadcountById" TEXT;
ALTER TABLE "Quote" ADD COLUMN "depositPct" INTEGER, ADD COLUMN "cancelFreeDays" INTEGER, ADD COLUMN "cancelMidPct" INTEGER, ADD COLUMN "cancelFullDays" INTEGER;
