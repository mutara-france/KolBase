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
npx prisma db push            # crée les tables
npm run db:seed               # données de démonstration
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

> Phase de démarrage : le schéma est appliqué avec `prisma db push`. Dès la première version
> stable, créer la migration initiale (`npm run db:migrate:dev -- --name init`), la versionner,
> et remplacer `preDeployCommand` par `npm run db:migrate` dans `render.yaml`.

## Feuille de route

1. Authentification (e-mail + mot de passe, puis Pro Santé Connect)
2. Espace praticien : Mon compte, inscriptions, référencement KOL
3. Espace organisation : annuaire, dossiers, événements
4. Conformité : hospitalités, conventions, export déclaratif
