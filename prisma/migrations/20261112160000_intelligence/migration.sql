-- KolBase Intelligence : concurrents suivis par une organisation et déclarations publiques (Transparence Santé)
-- qu'elle importe depuis un fichier téléchargé sur le site officiel.
CREATE TYPE "PublicLinkKind" AS ENUM ('convention', 'remuneration', 'avantage');

CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "kept" INTEGER NOT NULL,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "kind" "PublicLinkKind" NOT NULL,
    "date" TIMESTAMP(3),
    "amountCents" INTEGER NOT NULL,
    "beneficiaryId" TEXT,
    "beneficiaryName" TEXT,
    "category" TEXT,
    "purpose" TEXT,
    "sourceKey" TEXT NOT NULL,

    CONSTRAINT "PublicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Competitor_organizationId_name_key" ON "Competitor"("organizationId", "name");
CREATE INDEX "PublicImport_organizationId_idx" ON "PublicImport"("organizationId");
CREATE UNIQUE INDEX "PublicLink_competitorId_sourceKey_key" ON "PublicLink"("competitorId", "sourceKey");
CREATE INDEX "PublicLink_organizationId_beneficiaryId_idx" ON "PublicLink"("organizationId", "beneficiaryId");
CREATE INDEX "PublicLink_competitorId_date_idx" ON "PublicLink"("competitorId", "date");

ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicImport" ADD CONSTRAINT "PublicImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PublicImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
