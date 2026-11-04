-- Lot 5b : TVA par ligne de devis (repas 10 %, alcool 20 %). Le taux unique existant est repris sur chaque ligne ;
-- le total TTC (somme des lignes à leur taux) est enregistré.
UPDATE "Quote" q
SET "lines" = (SELECT coalesce(jsonb_agg(l || jsonb_build_object('vatBp', q."vatBp") ORDER BY i), '[]'::jsonb)
               FROM jsonb_array_elements(q."lines") WITH ORDINALITY AS x(l, i))
WHERE jsonb_typeof(q."lines") = 'array' AND q."lines" <> '[]'::jsonb;

ALTER TABLE "Quote" ADD COLUMN "ttcCents" INTEGER;
UPDATE "Quote" SET "ttcCents" = ROUND("amountCents" * (10000 + "vatBp") / 10000.0);
