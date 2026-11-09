-- Coordonnées de facturation propres à chaque structure du praticien (cabinet, société d'exercice, association…).
ALTER TABLE "PractitionerStructure" ADD COLUMN "billingAddress" TEXT,
ADD COLUMN "siret" TEXT,
ADD COLUMN "vatRegime" TEXT NOT NULL DEFAULT 'franchise',
ADD COLUMN "vatNumber" TEXT,
ADD COLUMN "iban" TEXT;

-- Au nom de qui chaque convention est facturée : une structure du praticien, ou son nom propre.
ALTER TABLE "ProjectExpert" ADD COLUMN "billingSelf" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "billingStructureId" TEXT;

ALTER TABLE "ProjectExpert" ADD CONSTRAINT "ProjectExpert_billingStructureId_fkey" FOREIGN KEY ("billingStructureId") REFERENCES "PractitionerStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise : saisies avec une structure de facturation, les coordonnées du profil étaient celles de la structure.
-- Elles lui sont rattachées ; celles du nom propre restent à saisir.
UPDATE "PractitionerStructure" s
SET "billingAddress" = p."billingAddress", "siret" = p."siret", "vatRegime" = p."vatRegime", "vatNumber" = p."vatNumber", "iban" = p."iban"
FROM "PractitionerProfile" p
WHERE s."practitionerId" = p."id" AND s."isPayee";

UPDATE "PractitionerProfile" p
SET "billingAddress" = NULL, "siret" = NULL, "vatRegime" = 'franchise', "vatNumber" = NULL, "iban" = NULL
WHERE EXISTS (SELECT 1 FROM "PractitionerStructure" s WHERE s."practitionerId" = p."id" AND s."isPayee");

-- Conventions déjà soumises à la conformité : le choix en vigueur (structure de facturation, sinon nom propre) est figé.
UPDATE "ProjectExpert" e
SET "billingStructureId" = s."id"
FROM "Project" pr, "PractitionerStructure" s
WHERE pr."id" = e."projectId" AND s."practitionerId" = e."practitionerId" AND s."isPayee"
  AND e."status" NOT IN ('ATT_EXPERTS', 'DECLINE') AND pr."status" NOT IN ('ATT_EXPERTS', 'ATT_IND', 'ACCORD', 'DECLINE');

UPDATE "ProjectExpert" e
SET "billingSelf" = true
FROM "Project" pr
WHERE pr."id" = e."projectId" AND e."billingStructureId" IS NULL
  AND e."status" NOT IN ('ATT_EXPERTS', 'DECLINE') AND pr."status" NOT IN ('ATT_EXPERTS', 'ATT_IND', 'ACCORD', 'DECLINE');
