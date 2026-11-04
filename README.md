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
npm run lint                  # vérification des types (variables et imports inutilisés refusés)
npm run deadcode              # fichiers, exports et dépendances inutilisés (knip, configuration knip.json)
npm test                      # tests unitaires (règles de visibilité, conformité, rôles, montants…)
# parcours de bout en bout : base chargée avec la démo, application lancée
BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
BASE=http://localhost:3000 DEMO_PASSWORD=… npm run test:a11y   # accessibilité (axe-core, WCAG 2.1 AA)
```

Chaque pull request passe par GitHub Actions (`.github/workflows/ci.yml`) : types, code mort, tests unitaires,
migrations appliquées à un PostgreSQL 17 neuf puis comparées au schéma Prisma (une migration oubliée
fait échouer la vérification), données de démo, build, audit des dépendances, parcours de bout en bout et accessibilité des pages principales.
Un second job (« montee-de-version ») rejoue le déploiement sur une base déjà en service : la version précédente
est installée et remplie avec la démo, puis cette version y applique ses migrations avec `scripts/predeploy.sh`.

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
en local, et versionner le dossier de migration créé. Trois règles, vérifiées par la CI quand c'est possible :

- **Horodatage** : une nouvelle migration doit être classée après toutes celles déjà en service (certaines portent
  une date à venir) ; sinon elle s'appliquerait dans un autre ordre en production que sur une base neuve.
- **Données réelles** : une migration qui transforme des données doit passer sur une base remplie (montants élevés,
  champs vides) ; le job « montee-de-version » le vérifie avec la démo.
- **En deux temps** pour retirer ou renommer une colonne : pendant le déploiement, l'ancienne version reste en
  service et lit encore toutes les colonnes de ses modèles (erreur « ColumnNotFound » le 2 novembre). D'abord la
  retirer du client (`@ignore` dans le schéma, la colonne reste en base), puis la supprimer dans un déploiement
  suivant (exemple : `PractitionerProfile.billingEntity`).

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

## Photos des praticiens

Un expert référencé ajoute sa photo depuis « Mon compte › Photo » (JPEG, PNG ou WebP, 10 Mo au plus). Elle n'est
jamais conservée telle quelle : `src/lib/photos.ts` (bibliothèque `sharp`) la redresse, la recadre au carré sur le visage
probable et la réencode sans métadonnées (position GPS, appareil, date), en deux tailles stockées en base
(`PractitionerPhoto` : JPEG 800 px, vignette WebP 192 px). Elle remplace le monogramme partout où l'expert apparaît,
selon le réglage « Photo » de la visibilité du profil (public par défaut, organisations, masquée), servie par
`/experts/<id>/photo`. Une case d'accord, révocable, autorise les organisations avec qui il collabore et KolBase à
l'utiliser pour annoncer ses interventions : le dossier propose alors la photo grand format. L'équipe KolBase contrôle
les dernières photos dans `/admin › Identités` et retire une photo inadaptée (le praticien est prévenu). La photo est
incluse dans l'export des données et effacée à la suppression du compte.

## Projets proposés par les experts

Un expert référencé propose un projet (formation, étude, webinaire, comité…) depuis « Sollicitations › Mes
propositions » ou la page d'une organisation : objectif, public, calendrier, honoraires souhaités face aux repères de
marché, pièce jointe si le stockage est configuré. Il choisit jusqu'à cinq organisations validées et référencées (hors
prestataires) ; chacune reçoit sa propre copie, un dossier « Proposition de l'expert », sans savoir qui d'autre l'a reçue.
Garde-fous : cinq propositions par période de 30 jours, une seule proposition en attente par organisation, engagement à
proposer une prestation réelle rémunérée à sa juste valeur. L'organisation accepte (contrat de sous-traitance et
abonnement exigés, comme pour une sollicitation) ou décline avec un motif transmis à l'expert ; l'expert peut retirer
sa proposition tant qu'elle n'a pas répondu. Les deux sont prévenus par e-mail.

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

## Tâches planifiées

Le service cron Render `kolbase-taches` (voir `render.yaml`) appelle toutes les heures `POST /api/taches` avec
l'en-tête `Authorization: Bearer $CRON_SECRET` (secret généré sur le service web et partagé). La tâche, idempotente :

- envoie le rappel de la veille aux inscrits (date, lieu, programme, badge) ;
- envoie, une heure après la fin d'un événement, le remerciement avec l'attestation de présence et le questionnaire ;
- supprime les sessions et liens de connexion expirés depuis plus de 30 jours.

`APP_URL` est fixée dans `render.yaml` pour le service cron (https://kolbase.io) ; sans elle, la commande échoue
en nommant la variable manquante. Activer les alertes d'échec du service cron dans Render (Settings ›
Notifications) : dès sa création le 3 novembre, faute d'`APP_URL`, les tâches ont échoué toutes les heures sans
que personne ne soit prévenu.

## Facturation

Abonnements mensuels sans engagement, payés par carte ou prélèvement SEPA via Stripe (`src/lib/billing.ts`) :

- **organisation** : 599 € HT par mois, à activer par un administrateur à la première action qui engage un tiers
  (sollicitation envoyée, appel à candidatures ou événement publié, demande de devis envoyée) ; les sociétés savantes,
  associations professionnelles et organismes de formation publient leurs événements gratuitement
  (`FREE_EVENT_KINDS`, `src/lib/billing-plans.ts`) ;
- **prestataire** : référencement gratuit ; 249 € HT par mois pour répondre à de nouvelles demandes après le premier
  devis retenu (le prestataire est prévenu à ce moment-là).

Formule annuelle au choix : dix mois facturés pour douze (5 990 € HT et 2 490 € HT par an). Premier mois offert (une fois), dossiers et déclarations toujours accessibles, gratuités accordées depuis
`/admin › Abonnements`. Variables : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (notification déclarée chez Stripe
vers `<APP_URL>/api/stripe/webhook`), `STRIPE_TAX_RATE` (taux de TVA `txr_…`). Sans clé, rien n'est facturé.
Activer le portail client dans le tableau de bord Stripe (moyen de paiement, factures, résiliation).

### Services KolBase

Sur chaque événement publié, les organisateurs commandent des services réalisés par l'équipe KolBase
(`src/lib/services.ts`) : e-mailing dédié, publication sur les réseaux sociaux, mise à la une de la page d'accueil
(7 jours). Catalogue et prix modifiables dans `/admin › Services`, où l'équipe planifie, réalise ou refuse les
commandes. Une commande réalisée est ajoutée à la prochaine facture Stripe de l'organisation (ou signalée « à
facturer hors Stripe » si elle n'a pas de client Stripe).

L'e-mailing ne part qu'aux membres qui ont accepté la lettre d'information (« Mon compte ») ; chaque envoi porte un
lien de désinscription et les en-têtes `List-Unsubscribe` (désinscription en un clic).

## Surveillance

Toute erreur serveur (page, action, route) est journalisée en JSON (Render › kolbase-web › Logs) et signalée par
e-mail aux `PLATFORM_ADMIN_EMAILS` (`src/instrumentation.ts`), au plus une fois par erreur toutes les 30 minutes et
dix fois par heure. `/api/health` vérifie l'application et la base (contrôle de santé Render).

## Double authentification

Chaque compte peut activer, depuis « Mon compte › Sécurité », un code à 6 chiffres donné par une application
d'authentification (TOTP, `src/lib/totp.ts`), avec dix codes de secours à usage unique. Elle est **obligatoire pour
les administrateurs de KolBase** (`PLATFORM_ADMIN_2FA=optional` la rend facultative, pour les tests) et chaque
organisation peut l'exiger de tous ses membres (« Membres et réglages › Organisation »). Un membre qui ne l'a pas
activée est renvoyé vers « Mon compte » ; chaque activation, désactivation ou utilisation d'un code de secours est
signalée par e-mail. En cas de perte du téléphone et des codes, un administrateur de la base peut remettre à zéro
`totpSecret`, `totpEnabledAt` et `recoveryCodes` du compte, après vérification de l'identité.

## Données personnelles

Depuis « Mon compte » : téléchargement des données du compte (JSON) et suppression du compte. La suppression
anonymise le compte (connexion impossible, fiche retirée, coordonnées, publications, suivis et candidatures en
attente effacés, inscriptions à venir annulées) ; le nom, la profession, le RPPS, la ville et la structure de
facturation ne sont conservés que s'ils figurent sur des conventions ou des hospitalités passées ou déclarées.

Chaque organisation accepte le **contrat de sous-traitance** (`/sous-traitance`, article 28 du RGPD) depuis
« Membres et réglages › Organisation » ; la version en vigueur est `DPA_VERSION` (`src/lib/dpa.ts`) : la changer
quand le texte change pour qu'il soit accepté à nouveau. Le registre des traitements de l'éditeur est dans
`docs/rgpd/registre-des-traitements.md`.

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
