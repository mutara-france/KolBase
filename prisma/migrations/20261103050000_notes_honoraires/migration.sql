-- Notes d'honoraires des experts : coordonnées de facturation et notes émises (figées).
ALTER TABLE "PractitionerProfile" ADD COLUMN "billingEntity" TEXT;
ALTER TABLE "PractitionerProfile" ADD COLUMN "billingAddress" TEXT;
ALTER TABLE "PractitionerProfile" ADD COLUMN "siret" TEXT;
ALTER TABLE "PractitionerProfile" ADD COLUMN "vatRegime" TEXT NOT NULL DEFAULT 'franchise';
ALTER TABLE "PractitionerProfile" ADD COLUMN "vatNumber" TEXT;
ALTER TABLE "PractitionerProfile" ADD COLUMN "iban" TEXT;

CREATE TABLE "FeeNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "projectExpertId" TEXT,
    "organizationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vatBp" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeeNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeeNote_projectExpertId_key" ON "FeeNote"("projectExpertId");
CREATE UNIQUE INDEX "FeeNote_practitionerId_number_key" ON "FeeNote"("practitionerId", "number");
CREATE INDEX "FeeNote_organizationId_idx" ON "FeeNote"("organizationId");
ALTER TABLE "FeeNote" ADD CONSTRAINT "FeeNote_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "PractitionerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeeNote" ADD CONSTRAINT "FeeNote_projectExpertId_fkey" FOREIGN KEY ("projectExpertId") REFERENCES "ProjectExpert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeeNote" ADD CONSTRAINT "FeeNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
