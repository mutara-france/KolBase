-- Références achats d'un dossier : bon de commande et centre de coûts.
ALTER TABLE "Project" ADD COLUMN "purchaseOrder" TEXT,
ADD COLUMN "costCenter" TEXT;
