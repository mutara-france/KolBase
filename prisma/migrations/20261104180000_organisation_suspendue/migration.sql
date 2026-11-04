-- Suspension réversible d'une organisation (statut distinct de « en attente »).
-- Seule dans sa migration : une valeur ajoutée à une énumération ne peut pas servir dans la même transaction
-- (prisma migrate deploy applique chaque fichier d'un bloc) ; la reprise des données suit dans la migration suivante.
ALTER TYPE "OrgVerification" ADD VALUE 'SUSPENDED';
