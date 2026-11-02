-- Rôles simplifiés : « Projets » regroupe Éducation, Événements et Éducation et événements ;
-- « Conformité » absorbe Relecture. Restent Administrateur et Prestataire (agence mandatée).
CREATE TYPE "OrgRole_new" AS ENUM ('ADMIN', 'PROJETS', 'CONFORMITE', 'PRESTATAIRE');

-- Une personne qui cumulait deux anciens rôles regroupés n'en garde qu'un (contrainte d'unicité).
DELETE FROM "Membership" m USING "Membership" k
WHERE m."userId" = k."userId" AND m."organizationId" = k."organizationId" AND m.id > k.id
  AND (CASE WHEN m.role::text IN ('EDUCATION', 'EVENEMENTS', 'CUMUL') THEN 'PROJETS' WHEN m.role::text = 'RELECTURE' THEN 'CONFORMITE' ELSE m.role::text END)
    = (CASE WHEN k.role::text IN ('EDUCATION', 'EVENEMENTS', 'CUMUL') THEN 'PROJETS' WHEN k.role::text = 'RELECTURE' THEN 'CONFORMITE' ELSE k.role::text END);

ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "OrgRole_new" USING (
  CASE WHEN "role"::text IN ('EDUCATION', 'EVENEMENTS', 'CUMUL') THEN 'PROJETS' WHEN "role"::text = 'RELECTURE' THEN 'CONFORMITE' ELSE "role"::text END
)::"OrgRole_new";
ALTER TABLE "Invitation" ALTER COLUMN "role" TYPE "OrgRole_new" USING (
  CASE WHEN "role"::text IN ('EDUCATION', 'EVENEMENTS', 'CUMUL') THEN 'PROJETS' WHEN "role"::text = 'RELECTURE' THEN 'CONFORMITE' ELSE "role"::text END
)::"OrgRole_new";

DROP TYPE "OrgRole";
ALTER TYPE "OrgRole_new" RENAME TO "OrgRole";
