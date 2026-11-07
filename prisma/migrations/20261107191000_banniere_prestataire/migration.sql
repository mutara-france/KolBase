-- Bannière de la vitrine d'un prestataire (image large en tête de sa page publique et de sa carte dans l'annuaire).
ALTER TABLE "Organization" ADD COLUMN "bannerUpdatedAt" TIMESTAMP(3);

CREATE TABLE "OrganizationBanner" (
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationBanner_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "OrganizationBanner" ADD CONSTRAINT "OrganizationBanner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
