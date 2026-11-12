-- KolBase Business : marque de l'organisation (nom affiché, couleur) et nom de domaine où KolBase est servi à sa marque.
CREATE TYPE "BrandDomainStatus" AS ENUM ('demande', 'active', 'retire');

-- Session ouverte sur le nom de domaine d'une organisation : limitée à ce domaine et à l'espace de l'organisation.
ALTER TABLE "Session" ADD COLUMN "brandOrgId" TEXT;

CREATE TABLE "OrgBrand" (
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT,
    "color" TEXT,
    "domain" TEXT,
    "domainStatus" "BrandDomainStatus",
    "domainRequestedAt" TIMESTAMP(3),
    "domainActivatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgBrand_pkey" PRIMARY KEY ("organizationId")
);

CREATE UNIQUE INDEX "OrgBrand_domain_key" ON "OrgBrand"("domain");

ALTER TABLE "OrgBrand" ADD CONSTRAINT "OrgBrand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
