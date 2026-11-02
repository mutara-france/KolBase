-- Book prestataire : capacités, équipements, accessibilité, prix indicatif.
ALTER TABLE "Organization" ADD COLUMN "capacities" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Organization" ADD COLUMN "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Organization" ADD COLUMN "accessible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "priceHint" TEXT;

CREATE TABLE "OrganizationPhoto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationPhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierReview" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationPhoto_organizationId_idx" ON "OrganizationPhoto"("organizationId");
CREATE INDEX "SupplierOffer_organizationId_idx" ON "SupplierOffer"("organizationId");
CREATE UNIQUE INDEX "SupplierReview_rfqId_key" ON "SupplierReview"("rfqId");
CREATE INDEX "SupplierReview_supplierId_idx" ON "SupplierReview"("supplierId");

ALTER TABLE "OrganizationPhoto" ADD CONSTRAINT "OrganizationPhoto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReview" ADD CONSTRAINT "SupplierReview_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReview" ADD CONSTRAINT "SupplierReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReview" ADD CONSTRAINT "SupplierReview_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReview" ADD CONSTRAINT "SupplierReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
