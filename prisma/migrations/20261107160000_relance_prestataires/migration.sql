-- Relance d'un prestataire consulté resté sans réponse (au plus une fois par 48 heures).
ALTER TABLE "RfqSupplier" ADD COLUMN "remindedAt" TIMESTAMP(3);
