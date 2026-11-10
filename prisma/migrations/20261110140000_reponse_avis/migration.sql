-- Réponse publique du prestataire à un avis vérifié (droit de réponse, une seule réponse par avis).
ALTER TABLE "SupplierReview" ADD COLUMN "reply" TEXT;
ALTER TABLE "SupplierReview" ADD COLUMN "repliedAt" TIMESTAMP(3);
