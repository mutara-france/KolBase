-- Paiement des honoraires d'un expert, indiqué par l'organisation.
ALTER TABLE "ProjectExpert" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "ProjectExpert" ADD COLUMN "paidCents" INTEGER;

-- Liens d'intérêts noués hors de KolBase, déclarés par le praticien.
CREATE TABLE "DeclaredInterest" (
    "id" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "startYear" INTEGER NOT NULL,
    "endYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclaredInterest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeclaredInterest_practitionerId_idx" ON "DeclaredInterest"("practitionerId");

ALTER TABLE "DeclaredInterest" ADD CONSTRAINT "DeclaredInterest_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "PractitionerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
