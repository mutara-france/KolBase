# KolBase — règles pour les sessions de développement (humaines ou IA)

Plateforme Next.js 16 (App Router, actions serveur) + Prisma 7 + PostgreSQL 17, hébergée sur Render (Francfort).
Chaque commit sur `main` dont la CI passe part **en production** : il n'y a pas d'autre environnement pour l'instant.

## Livrer

- Une branche par sujet, une PR de moins de 500 lignes si possible ; jamais de poussée directe sur `main`.
- Avant d'ouvrir ou de fusionner une PR : la mettre à jour avec `main` (plusieurs sessions travaillent en parallèle) ;
  ne jamais réécrire l'historique d'une branche déjà poussée par quelqu'un d'autre.
- **Ne pas fusionner sans l'accord explicite de Mutara** une PR qui touche : authentification ou droits d'accès,
  facturation (Stripe, abonnements, prix), migrations de base, textes légaux (CGU, CGV, confidentialité, sous-traitance).
- Regrouper les mises en production (vers 12 h et 18 h) : chaque déploiement casse les formulaires des onglets ouverts
  (« Failed to find Server Action »).

## Vérifier avant la PR

```bash
npm run lint          # types (strict, sans variable ni import inutilisés)
npm run check         # Biome : lint (dépendances des hooks, variables inutilisées…)
npm run deadcode      # knip : fichiers, exports et dépendances inutilisés
npm run test:coverage # tests unitaires + couverture minimale des modules de règles (vitest.config.mts)
npm run build
BASE=http://localhost:3000 npm run test:e2e   # base chargée avec la démo, application lancée
```

La CI (`.github/workflows/ci.yml`) fait référence. Dans un bac à sable où le moteur Prisma ne se télécharge pas,
`PRISMA_SCHEMA_ENGINE_BINARY` pointé vers un exécutable factice suffit à `prisma generate` ; les migrations s'appliquent
alors avec `psql`, et `prisma migrate diff` est vérifié par la CI.

## Base de données

- Nouvelle migration : horodatage **après la dernière migration existante** (certaines sont datées dans le futur ;
  la CI refuse une migration classée avant).
- Une migration qui transforme des données doit passer sur une base remplie : le job « montee-de-version » la rejoue
  sur la version précédente chargée avec la démo.
- Retirer ou renommer une colonne en deux déploiements : d'abord `@ignore` dans le schéma (l'ancienne version encore
  en service la lit toujours), puis `DROP COLUMN` dans un déploiement suivant.
- Montants en centimes entiers ; en SQL, calculer en `numeric` (un produit d'entiers 32 bits déborde vers 21 474 €).
- Statuts : énumérations Prisma, pas de texte libre.

## Code

- Accès à une organisation : `requireMembership` dans ses pages et actions ; ailleurs (téléchargements, actions
  partagées avec l'expert), `memberRoles` / `hasMemberRole` (`src/lib/org-roles.ts`), jamais `user.memberships`
  directement — ils appliquent l'exigence de double authentification de l'organisation.
- Limitation des tentatives : `src/lib/rate-limit.ts` (en base, fonctions asynchrones).
- Envois planifiés (rappels, remerciements, bilans) : `sendOnce` dans `notifications.ts`, la date d'envoi est posée
  avant l'e-mail.
- Textes de l'interface : `t("texte français")`, avec sa traduction dans `src/lib/i18n/en` (un test échoue sinon).
  L'espace organisation reste en français.
- Démonstration : identifiants `demo-…`, adresses `@demo.kolbase.local` (`src/lib/demo.ts`). Aucun contenu fictif n'est
  attribué à une organisation réelle (Straumann Group, Septodont, Mega Dental).
- Suivre le style du fichier modifié ; pas de reformatage global (il gonflerait chaque diff et casserait les branches en cours).
- Commentaires en français, qui disent pourquoi ; pas de `any`.
