-- Base publique Transparence Santé tenue par l'équipe KolBase (KolBase Intelligence) : imports, liens publiés,
-- écritures sous lesquelles chaque organisation cliente y déclare.
CREATE TYPE "MarketImportStatus" AS ENUM ('en_cours', 'pret', 'echec');

CREATE TABLE "MarketImport" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "MarketImportStatus" NOT NULL DEFAULT 'en_cours',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "kept" INTEGER NOT NULL DEFAULT 0,
    "companies" INTEGER NOT NULL DEFAULT 0,
    "people" INTEGER NOT NULL DEFAULT 0,
    "firstYear" INTEGER,
    "lastYear" INTEGER,
    "error" TEXT,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MarketImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketLink" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "sector" TEXT,
    "kind" "PublicLinkKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "purpose" TEXT,
    "personKey" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "rpps" TEXT,
    "category" TEXT,
    "city" TEXT,
    "region" TEXT,

    CONSTRAINT "MarketLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketProfile" (
    "organizationId" TEXT NOT NULL,
    "names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProfile_pkey" PRIMARY KEY ("organizationId")
);

CREATE INDEX "MarketLink_importId_companyKey_year_idx" ON "MarketLink"("importId", "companyKey", "year");
CREATE INDEX "MarketLink_importId_personKey_idx" ON "MarketLink"("importId", "personKey");
CREATE INDEX "MarketLink_importId_nameKey_idx" ON "MarketLink"("importId", "nameKey");

ALTER TABLE "MarketLink" ADD CONSTRAINT "MarketLink_importId_fkey" FOREIGN KEY ("importId") REFERENCES "MarketImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketProfile" ADD CONSTRAINT "MarketProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
