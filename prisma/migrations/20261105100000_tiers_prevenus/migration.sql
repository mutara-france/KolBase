-- Lot 5a : prévenir les tiers.
-- Motif de l'abandon d'un dossier (affiché à l'expert sur sa sollicitation).
ALTER TABLE "Project" ADD COLUMN "abandonNote" TEXT;
-- Déclin d'une demande de devis par un prestataire : motif facultatif et date.
ALTER TABLE "RfqSupplier" ADD COLUMN "declineNote" TEXT, ADD COLUMN "declinedAt" TIMESTAMP(3);
-- Événement annulé (motif) : il reste lisible à son adresse, hors de l'agenda ; ses inscriptions sont annulées.
ALTER TABLE "Event" ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Registration" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Reprise : motif des dossiers déjà abandonnés, tel qu'il figure au journal (dernier abandon).
UPDATE "Project" p SET "abandonNote" = a.note
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "data"->>'note' AS note
  FROM "AuditLog" WHERE "entityType" = 'Project' AND action = 'project.abandon' AND "data"->>'note' IS NOT NULL
  ORDER BY "entityId", "createdAt" DESC
) a
WHERE a."entityId" = p.id AND p.status = 'DECLINE' AND p."abandonNote" IS NULL;
