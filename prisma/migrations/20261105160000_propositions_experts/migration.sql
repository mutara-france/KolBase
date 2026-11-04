-- Projets proposés par les experts : une proposition, une copie (dossier) par organisation destinataire.
CREATE TABLE "ExpertProposal" (
    "id" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "therapeuticArea" TEXT,
    "description" TEXT NOT NULL,
    "audience" TEXT,
    "schedule" TEXT,
    "feeCents" INTEGER,
    "units" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertProposal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Project" ADD COLUMN "proposalId" TEXT;

CREATE INDEX "ExpertProposal_practitionerId_createdAt_idx" ON "ExpertProposal"("practitionerId", "createdAt");
CREATE INDEX "Project_proposalId_idx" ON "Project"("proposalId");

ALTER TABLE "ExpertProposal" ADD CONSTRAINT "ExpertProposal_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "PractitionerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ExpertProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise : chaque proposition déjà envoyée (une organisation, un expert) devient une proposition à une copie.
INSERT INTO "ExpertProposal" ("id", "practitionerId", "title", "typeId", "therapeuticArea", "description", "feeCents", "units", "createdAt")
SELECT 'prop_' || p."id", e."practitionerId", p."title", p."typeId", p."therapeuticArea", COALESCE(p."description", ''), e."feeCents", e."days", p."createdAt"
FROM "Project" p
JOIN LATERAL (SELECT x."practitionerId", x."feeCents", x."days" FROM "ProjectExpert" x WHERE x."projectId" = p."id" ORDER BY x."createdAt" LIMIT 1) e ON TRUE
WHERE p."origin" = 'Proposition de l''expert';

UPDATE "Project" SET "proposalId" = 'prop_' || "id"
WHERE "origin" = 'Proposition de l''expert' AND EXISTS (SELECT 1 FROM "ExpertProposal" WHERE "id" = 'prop_' || "Project"."id");
