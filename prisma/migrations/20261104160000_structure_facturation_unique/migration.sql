-- Une seule structure de facturation par praticien : la « Société d'exercice » saisie dans les coordonnées de
-- facturation rejoint les structures juridiques (structure de facturation), lue par les conventions et les notes
-- d'honoraires. Une structure de facturation déjà déclarée est gardée telle quelle.
INSERT INTO "PractitionerStructure" ("id", "practitionerId", "name", "legalForm", "siren", "isPayee")
SELECT 'fact-' || p."id", p."id", btrim(p."billingEntity"),
       COALESCE(substring(btrim(p."billingEntity") from '^(SELARL|SELAS|SASU|SARL|SCM|SCP|EURL|SAS)( |$)'), 'Société d''exercice'),
       CASE WHEN p."siret" ~ '^[0-9]{14}$' THEN substring(p."siret" from 1 for 9) END,
       true
FROM "PractitionerProfile" p
WHERE p."billingEntity" IS NOT NULL AND btrim(p."billingEntity") <> ''
  AND NOT EXISTS (SELECT 1 FROM "PractitionerStructure" s WHERE s."practitionerId" = p."id" AND s."isPayee");

ALTER TABLE "PractitionerProfile" DROP COLUMN "billingEntity";
