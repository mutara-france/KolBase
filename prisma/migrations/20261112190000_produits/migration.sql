-- Produits de l'organisation (KolBase Intelligence) : dossiers et événements s'y rattachent, sans transformation des
-- données existantes (rattachement facultatif, vide au départ).
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "range" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Project" ADD COLUMN "productId" TEXT;
ALTER TABLE "Event" ADD COLUMN "productId" TEXT;

CREATE UNIQUE INDEX "Product_organizationId_name_key" ON "Product"("organizationId", "name");
CREATE INDEX "Project_productId_idx" ON "Project"("productId");
CREATE INDEX "Event_productId_idx" ON "Event"("productId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
