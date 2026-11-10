-- Zone d'intervention structurée des prestataires : régions couvertes, ou France entière.
ALTER TABLE "Organization" ADD COLUMN "coverageRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Organization" ADD COLUMN "coverageNational" BOOLEAN NOT NULL DEFAULT false;
