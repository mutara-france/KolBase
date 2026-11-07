-- Grille de rémunération (taux horaires définis par la conformité) et volume horaire déclaré par expert.
CREATE TABLE "FeeLevel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hourlyCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeLevel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FeeLevel_organizationId_idx" ON "FeeLevel"("organizationId");
ALTER TABLE "FeeLevel" ADD CONSTRAINT "FeeLevel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectExpert" ADD COLUMN "prepHours" DOUBLE PRECISION;
ALTER TABLE "ProjectExpert" ADD COLUMN "interventionHours" DOUBLE PRECISION;
ALTER TABLE "ProjectExpert" ADD COLUMN "travelHours" DOUBLE PRECISION;
ALTER TABLE "ProjectExpert" ADD COLUMN "feeLevelId" TEXT;
ALTER TABLE "ProjectExpert" ADD COLUMN "feeLevelLabel" TEXT;
ALTER TABLE "ProjectExpert" ADD COLUMN "hourlyCents" INTEGER;
ALTER TABLE "ProjectExpert" ADD CONSTRAINT "ProjectExpert_feeLevelId_fkey" FOREIGN KEY ("feeLevelId") REFERENCES "FeeLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
