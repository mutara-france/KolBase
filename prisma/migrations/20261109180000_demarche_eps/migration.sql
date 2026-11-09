-- Démarche EPS d'un dossier : date et référence de la déclaration simple, date de la demande d'autorisation à l'Ordre.
ALTER TABLE "Project" ADD COLUMN "epsDeclaredAt" TIMESTAMP(3),
ADD COLUMN "epsRef" TEXT,
ADD COLUMN "ordreRequestedAt" TIMESTAMP(3);

-- Reprise : les démarches déjà faites sont datées d'après le journal d'activité (dernier passage par l'étape).
UPDATE "Project" p
SET "epsDeclaredAt" = (SELECT max(a."createdAt") FROM "AuditLog" a WHERE a."entityType" = 'Project' AND a."entityId" = p."id" AND a."action" = 'project.declaration')
WHERE p."epsDeclaredAt" IS NULL;

UPDATE "Project" p
SET "ordreRequestedAt" = (SELECT max(a."createdAt") FROM "AuditLog" a WHERE a."entityType" = 'Project' AND a."entityId" = p."id" AND a."action" = 'project.ordre')
WHERE p."ordreRequestedAt" IS NULL;
