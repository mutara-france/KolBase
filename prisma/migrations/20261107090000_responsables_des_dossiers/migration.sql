-- Responsables des dossiers (vue « Mes dossiers », destinataires des e-mails du dossier).
CREATE TABLE "ProjectLead" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLead_pkey" PRIMARY KEY ("projectId","userId")
);

CREATE INDEX "ProjectLead_userId_idx" ON "ProjectLead"("userId");

ALTER TABLE "ProjectLead" ADD CONSTRAINT "ProjectLead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectLead" ADD CONSTRAINT "ProjectLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise : le créateur de chaque dossier en devient responsable, s'il est toujours Administrateur ou Projets de
-- l'organisation (un projet proposé par un expert reste sans responsable jusqu'à ce qu'un membre le fasse avancer).
INSERT INTO "ProjectLead" ("projectId", "userId", "createdAt")
SELECT DISTINCT p."id", p."createdById", p."createdAt"
FROM "Project" p
JOIN "Membership" m ON m."userId" = p."createdById" AND m."organizationId" = p."organizationId" AND m."role" IN ('ADMIN', 'PROJETS');
