-- Codes postaux (facultatifs) du lieu d'exercice et des événements : région dans les statistiques.
ALTER TABLE "PractitionerProfile" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "Event" ADD COLUMN "postalCode" TEXT;
