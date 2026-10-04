#!/usr/bin/env sh
# Exécuté par Render avant chaque mise en production.
set -e
node scripts/baseline.mjs
npx prisma migrate deploy
if [ "$SEED_DEMO" = "1" ]; then
  echo "SEED_DEMO=1 : chargement des données de démonstration"
  npm run db:seed
fi
