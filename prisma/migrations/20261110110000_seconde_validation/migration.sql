-- Seconde validation d'un dossier au-delà d'un seuil d'honoraires : première validation enregistrée sur le dossier.
ALTER TABLE "Project" ADD COLUMN "firstValidatedById" TEXT,
ADD COLUMN "firstValidatedAt" TIMESTAMP(3);
