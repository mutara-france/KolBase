#!/usr/bin/env sh
# Exécuté par Render avant chaque mise en production.
set -e
node scripts/baseline.mjs
node scripts/retry-failed.mjs
npx prisma migrate deploy
# Logos des organisations partenaires publiées avec leur accord (posés s'ils manquent, jamais remplacés).
node scripts/partner-logos.mjs
# Actualités rédigées dans le dépôt (scripts/actualites) : posées une fois, en brouillon, à publier depuis /admin.
node scripts/actualites.mjs
if [ "$SEED_DEMO" = "1" ]; then
  echo "SEED_DEMO=1 : chargement des données de démonstration"
  npm run db:seed
fi
