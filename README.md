# KolBase

Plateforme de gestion de la relation entre praticiens (KOL) et organisations du secteur dentaire :
industriels, sociétés savantes, associations, organismes de formation.

## Stack

- **Next.js 16** (App Router, TypeScript) — front et API dans une seule application
- **PostgreSQL 17** + **Prisma 7** (adaptateur `pg`)
- **Render** (région Francfort) — décrit dans `render.yaml`

## Démarrer en local

```bash
cp .env.example .env          # renseigner DATABASE_URL et AUTH_SECRET
npm install
npx prisma migrate deploy     # crée les tables (migrations versionnées)
DEMO_PASSWORD=… npm run db:seed   # données fictives de démonstration
npm run dev                   # http://localhost:3000
```

Santé de l'application : `GET /api/health`.

## Modèle de données

Voir `prisma/schema.prisma`. Principes repris du prototype :

- Un **compte** unique par personne ; un praticien devient **KOL** en se référençant (`PractitionerProfile.listed`).
- Les **organisations** ont des membres avec des rôles : éducation, événements, cumul, prestataire mandaté, relecture, conformité.
- Les **dossiers** (`Project`) suivent le pipeline réglementaire (attente experts → accord → conformité → Ordre → signature → terminé).
- Les **inscriptions** aux événements sont nominatives ; chaque **hospitalité** acceptée est valorisée et figée (`RegistrationBenefit`) pour la déclaration.
- Toute action sensible est tracée dans `AuditLog`.

## Déploiement

Chaque commit sur `main` est déployé automatiquement par Render.

Avant chaque mise en production, Render exécute `npm run deploy:prepare` (`scripts/predeploy.sh`) :

1. baseline automatique d'une base créée avant les migrations (`scripts/baseline.mjs`) ;
2. `prisma migrate deploy` (dossier `prisma/migrations`) ;
3. si `SEED_DEMO=1`, chargement des données fictives (`prisma/seed.ts`, idempotent).

Pour faire évoluer le modèle : modifier `prisma/schema.prisma`, puis `npm run db:migrate:dev -- --name <nom>`
en local, et versionner le dossier de migration créé.

### Données de démonstration

Variables Render : `SEED_DEMO` (1 = actif, 0 = désactivé), `DEMO_PASSWORD` (mot de passe commun des comptes
`@demo.kolbase.local`), `DEMO_ADMIN_EMAILS` (comptes réels à rendre administrateurs des organisations de démo).

## Feuille de route

1. Authentification (e-mail + mot de passe, puis Pro Santé Connect)
2. Espace praticien : Mon compte, inscriptions, référencement KOL
3. Espace organisation : annuaire, dossiers, événements
4. Conformité : hospitalités, conventions, export déclaratif
