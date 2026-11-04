-- Lot 5a : négociation des honoraires. Montant précédent quand l'organisation propose d'autres honoraires ou accepte
-- ceux de l'expert (rappelé à l'expert : « 1 500 € → 1 800 € HT »).
ALTER TABLE "ProjectExpert" ADD COLUMN "previousFeeCents" INTEGER;
