-- Pack de services KolBase (prix réduit, réparti entre les services compris).
ALTER TABLE "ServiceOffer" ADD COLUMN "includes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ServiceOrder" ADD COLUMN "packLabel" TEXT;

INSERT INTO "ServiceOffer" ("id", "code", "kind", "includes", "label", "description", "priceCents", "position", "updatedAt") VALUES
  ('svc-pack', 'pack-visibilite', 'pack', ARRAY['newsletter', 'reseaux', 'une'], 'Pack visibilité', 'E-mailing dédié, publication sur les réseaux sociaux et mise à la une de la page d''accueil pendant sept jours, coordonnés par l''équipe KolBase.', 99000, 0, now())
ON CONFLICT ("code") DO NOTHING;
