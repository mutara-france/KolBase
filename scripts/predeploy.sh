#!/usr/bin/env sh
# Exécuté par Render avant chaque mise en production.
set -e
node scripts/baseline.mjs
node scripts/retry-failed.mjs
npx prisma migrate deploy
# Logos des organisations partenaires publiées avec leur accord (posés s'ils manquent, jamais remplacés).
node scripts/partner-logos.mjs
if [ "$SEED_DEMO" = "1" ]; then
  echo "SEED_DEMO=1 : chargement des données de démonstration"
  npm run db:seed
fi
