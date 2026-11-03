-- Straumann, Septodont et Mega Dental : publication avec l'accord des entreprises (nom et logo).
-- Identifiants lisibles dans l'adresse publique (/structures/straumann) ; les clés étrangères suivent (ON UPDATE CASCADE).
UPDATE "Organization" SET "id" = 'straumann' WHERE "id" = 'apercu-straumann';
UPDATE "Organization" SET "id" = 'septodont' WHERE "id" = 'apercu-septodont';
UPDATE "Organization" SET "id" = 'megadental' WHERE "id" = 'apercu-megadental';
UPDATE "AuditLog" SET "entityId" = substring("entityId" from 8) WHERE "entityType" = 'Organization' AND "entityId" IN ('apercu-straumann', 'apercu-septodont', 'apercu-megadental');

UPDATE "Organization"
SET "listed" = true,
    "verificationNote" = 'Organisation réelle, publiée avec son accord (nom et logo).'
WHERE "id" IN ('straumann', 'septodont', 'megadental');

-- Le compte d'aperçu partagé n'administre plus des organisations réelles.
DELETE FROM "Membership" WHERE "userId" = 'demo-u-apercu' AND "organizationId" IN ('straumann', 'septodont', 'megadental');
