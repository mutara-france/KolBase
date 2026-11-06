-- Délais internes de la conformité : date d'intervention prévue, soumission, relance.
ALTER TABLE "Project" ADD COLUMN "plannedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "reviewReminderAt" TIMESTAMP(3);

-- Dossiers en cours d'examen : date de leur dernière soumission, d'après l'historique.
UPDATE "Project" p SET "submittedAt" = s.at
FROM (SELECT "entityId", max("createdAt") AS at FROM "AuditLog" WHERE "entityType" = 'Project' AND "action" = 'project.submit' GROUP BY "entityId") s
WHERE s."entityId" = p."id" AND p."status" = 'EN_VALID';
