# KolBase

Plateforme de gestion de la relation entre praticiens (KOL) et organisations du secteur dentaire :
industriels, sociétés savantes, associations, organismes de formation.

## Stack

- **Next.js 16** (App Router, TypeScript) — front et API dans une seule application
- **PostgreSQL 17** + **Prisma 7** (adaptateur `pg`)
- **Render** (région Francfort) — décrit dans `render.yaml`

## Démarrer en local

```bash
cp .env.example .env          # renseigner DATABASE_URL
npm install
npx prisma migrate deploy     # crée les tables (migrations versionnées)
DEMO_PASSWORD=… npm run db:seed   # données fictives de démonstration
npm run dev                   # http://localhost:3000
```

Santé de l'application : `GET /api/health`.

## Tests

```bash
npm run lint                  # vérification des types
npm test                      # tests unitaires (règles de visibilité, conformité, rôles, montants…)
# parcours de bout en bout : base chargée avec la démo, application lancée
BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
```

Chaque pull request passe par GitHub Actions (`.github/workflows/ci.yml`) : types, tests unitaires,
migrations appliquées à un PostgreSQL 17 neuf puis comparées au schéma Prisma (une migration oubliée
fait échouer la vérification), données de démo, build, audit des dépendances et parcours de bout en bout.

## Modèle de données

Voir `prisma/schema.prisma`. Principes repris du prototype :

- Un **compte** unique par personne ; un praticien devient **KOL** en se référençant (`PractitionerProfile.listed`).
- Les **organisations** ont des membres avec des rôles : éducation, événements, cumul, prestataire mandaté, relecture, conformité.
- Les **dossiers** (`Project`) suivent le pipeline réglementaire (attente experts → accord → conformité → Ordre → signature → terminé).
- Les **inscriptions** aux événements sont nominatives ; chaque **hospitalité** acceptée est valorisée et figée (`RegistrationBenefit`) pour la déclaration.
- Toute action sensible est tracée dans `AuditLog`.

## Déploiement

Chaque commit sur `main` est déployé automatiquement par Render, une fois les vérifications GitHub (CI) réussies
(`autoDeployTrigger: checksPass`). Protéger `main` dans GitHub (vérification « verifier » obligatoire avant fusion)
évite qu'un commit non testé y arrive.

Avant chaque mise en production, Render exécute `npm run deploy:prepare` (`scripts/predeploy.sh`) :

1. baseline automatique d'une base créée avant les migrations (`scripts/baseline.mjs`) ;
2. `prisma migrate deploy` (dossier `prisma/migrations`) ;
3. si `SEED_DEMO=1`, chargement des données fictives (`prisma/seed.ts`, idempotent).

Pour faire évoluer le modèle : modifier `prisma/schema.prisma`, puis `npm run db:migrate:dev -- --name <nom>`
en local, et versionner le dossier de migration créé.

### Données de démonstration

Variables Render : `SEED_DEMO` (1 = actif, 0 = désactivé), `DEMO_PASSWORD` (mot de passe commun des comptes
`@demo.kolbase.local`), `DEMO_ADMIN_EMAILS` (comptes réels à rendre administrateurs des organisations de démo).

## Validation des organisations et des praticiens

- **Organisations** : à la création, le SIREN (obligatoire pour un industriel, un organisme de formation ou un
  prestataire) est contrôlé dans le répertoire public des entreprises. L'organisation reste « en attente » —
  sans sollicitation, publication ni page publique — jusqu'à sa validation par un administrateur KolBase.
  Changer son nom ou son SIREN relance la validation.
- **Praticiens** : seuls les chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues peuvent se
  référencer comme experts, avec un numéro RPPS (clé de Luhn contrôlée). Un administrateur KolBase le contrôle sur
  l'Annuaire Santé ; le badge « Identité vérifiée » s'affiche ensuite.
- **Praticiens exerçant hors de France** (`src/lib/countries.ts`) : pays d'exercice et identifiant du pays (INAMI en
  Belgique, NPI aux États-Unis, n° d'Ordre ailleurs), contrôlé de la même façon. Un dossier dont tous les experts
  exercent à l'étranger sort du circuit EPS (étape « Hors France ») ; le dossier, le registre et la convention
  rappellent les règles du pays (Sunshine Act belge et visa Mdeon, Open Payments, code MedTech Europe).
- **ORCID** : avec `ORCID_CLIENT_ID` / `ORCID_CLIENT_SECRET`, le praticien prouve son iD en se connectant à
  son compte ORCID avant d'importer ses publications.
- **Administration** : page `/admin`, réservée aux comptes listés dans `PLATFORM_ADMIN_EMAILS` (adresse confirmée
  exigée dès que l'envoi d'e-mails est configuré).

## E-mails

Envoi par SMTP (`SMTP_URL`, `MAIL_FROM`), après la réponse au navigateur : une panne d'envoi ne bloque jamais
une action. Sans `SMTP_URL`, le contenu des e-mails est écrit dans les journaux du serveur. Aucun e-mail ne part
vers les adresses réservées (`.local`, `.test`…), donc vers les comptes de démonstration.

- **Service** (toujours envoyés) : mot de passe oublié (lien d'une heure, à usage unique), confirmation
  d'adresse à l'inscription (7 jours), invitation à rejoindre une organisation quand l'adresse est connue.
- **Notifications** (désactivables dans Mon compte) : sollicitation et proposition d'honoraires, réponse de
  l'expert, messages, proposition spontanée, candidatures (reçue, non retenue), circuit de conformité,
  demandes de devis et devis reçus ; organisations et RPPS à valider pour les administrateurs KolBase.

## Documents des dossiers

Avec un stockage objet S3 compatible (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`), l'équipe d'un dossier et ses experts déposent des pièces (PDF, images, documents
bureautiques, 10 Mo au maximum). La **convention signée** de chaque expert engagé est alors exigée pour passer
le dossier en « Signé », et ne peut plus être retirée ensuite. Le compartiment reste privé : les fichiers ne
sont servis que par KolBase (`/documents/<id>`), après contrôle des droits (équipe de l'organisation ou expert
concerné). Sans ces variables, le dépôt est désactivé et le circuit de signature reste celui d'avant.

## Signature électronique (facultatif)

Avec `YOUSIGN_API_KEY` (API v3 de Yousign, devenu Youtrust ; `YOUSIGN_API_URL` vide = production,
`https://api-sandbox.yousign.app/v3` pour le bac à sable), chaque expert engagé d'un dossier « En signature » peut
recevoir sa convention en **signature électronique** : KolBase génère le PDF, crée la demande chez Yousign avec deux
signataires (la personne qui envoie, pour l'organisation, et l'expert, à l'adresse de son compte ; signature
électronique simple, code par e-mail) et un champ dans chaque cadre de signature de la dernière page. Yousign écrit
aux signataires.

- **Webhook** : déclarer chez Yousign `<APP_URL>/api/signature/webhook` (au moins `signature_request.done`,
  `.declined`, `.expired` et `.canceled`) et renseigner son secret dans `YOUSIGN_WEBHOOK_SECRET` (en-tête
  `X-Yousign-Signature-256` vérifié). À la signature, la convention signée
  rejoint les documents du dossier si le stockage est configuré ; sinon elle est servie depuis Yousign
  (`/signatures/<id>`, mêmes droits que les conventions). Sans webhook, « Mettre à jour le statut » interroge l'API.
- Une signature électronique achevée vaut convention signée pour passer le dossier en « Signé ».
- Sans ces variables, rien ne change (signature sur papier, puis dépôt du scan).

## Données personnelles

Depuis « Mon compte » : téléchargement des données du compte (JSON) et suppression du compte. La suppression
anonymise le compte (connexion impossible, fiche retirée, coordonnées, publications, suivis et candidatures en
attente effacés, inscriptions à venir annulées) ; le nom, la profession, le RPPS, la ville et la structure de
facturation ne sont conservés que s'ils figurent sur des conventions ou des hospitalités passées ou déclarées.

## Avant l'ouverture au public

L'onglet **Lancement** de `/admin` indique ce qui reste à faire sur l'environnement en ligne.

1. **Textes légaux** : renseigner `src/lib/legal.ts` (éditeur, forme sociale, siège, immatriculation, directeur
   de la publication, contacts, juridiction, prestataires), repris par les mentions légales, les CGU et la
   politique de confidentialité ; revoir les durées de conservation avec un conseil.
2. **Variables Render** : `PLATFORM_ADMIN_EMAILS`, `SMTP_URL`, `MAIL_FROM` (et `ORCID_CLIENT_ID` /
   `ORCID_CLIENT_SECRET` si la connexion ORCID est souhaitée, `YOUSIGN_API_KEY` / `YOUSIGN_WEBHOOK_SECRET` pour la
   signature électronique).
3. **Démo** : passer `SEED_DEMO` à `0` (sinon le déploiement suivant la recharge), puis, depuis le shell Render,
   `npm run db:purge-demo` (aperçu) et `npm run db:purge-demo -- --confirmer` (suppression). Les comptes réels
   sont conservés.
4. **Administration** : revoir dans `/admin` les organisations reprises comme validées.
5. **Sauvegardes** : vérifier les sauvegardes de la base PostgreSQL proposées par le plan Render.

## Feuille de route

1. Authentification (e-mail + mot de passe, puis Pro Santé Connect)
2. Espace praticien : Mon compte, inscriptions, référencement KOL
3. Espace organisation : annuaire, dossiers, événements
4. Conformité : hospitalités, conventions, export déclaratif
