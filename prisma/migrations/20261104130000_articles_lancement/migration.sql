-- Premiers articles de lancement, en brouillon : l'équipe KolBase les relit et les publie depuis /admin › Actualités.
INSERT INTO "Article" ("id", "slug", "category", "title", "excerpt", "body", "publishedAt", "createdAt", "updatedAt") VALUES
  ('art-lettre-information', 'la-lettre-d-information-de-kolbase', 'Plateforme', 'La lettre d''information de KolBase : les événements scientifiques à venir, deux fois par mois au plus', 'Formations, symposiums, journées scientifiques et nouveautés de la plateforme : la lettre d''information réunit l''essentiel pour les chirurgiens-dentistes. Elle n''est envoyée qu''à ceux qui l''ont demandée.', 'Chaque mois, des organismes de formation, des sociétés savantes et des industriels publient leurs événements sur KolBase. La lettre d''information vous les signale avant que les places ne partent.

## Ce que vous y trouverez

- Les **événements scientifiques à venir** : formations, travaux pratiques, symposiums, webinaires, avec la date, le lieu et le lien d''inscription.
- Les **nouveautés de KolBase** : nouvelles fonctions pour les praticiens et les experts.
- Des **repères réglementaires** utiles : liens d''intérêts, conventions, Transparence Santé.

## Ce que vous n''y trouverez pas

- Plus de **deux envois par mois**.
- Des communications d''organisations non identifiées : quand un envoi présente l''événement d''une organisation partenaire, il porte la mention « Communication de [organisation], diffusée par KolBase ».
- Vos coordonnées transmises à des tiers : la lettre part de KolBase et votre adresse n''est jamais communiquée aux organisations.

## Comment s''abonner ou se désabonner

Cochez « Recevoir la lettre d''information » dans [Mon compte](/compte), ou répondez « Oui, je m''abonne » sur votre page d''accueil. Pas encore de compte ? [Créez-le gratuitement](/inscription?next=/actualites) en cochant la case prévue.

Chaque lettre contient un lien de désinscription : un clic suffit, sans connexion.', NULL, now(), now()),
  ('art-experts-referencement', 'experts-ce-que-change-le-referencement-sur-kolbase', 'Conseils', 'Experts : ce que change le référencement sur KolBase', 'Être trouvé par les bonnes organisations, recevoir des sollicitations claires, signer ses conventions en ligne et garder ses liens d''intérêts à jour : le référencement est gratuit et se règle en quelques minutes.', 'Industriels, sociétés savantes et organismes de formation cherchent régulièrement des intervenants, des formateurs ou des membres de comités. Le référencement comme expert permet de vous trouver, dans un cadre conforme.

## Une fiche dont vous gardez la maîtrise

- Votre **identité professionnelle est vérifiée** sur l''Annuaire Santé (RPPS) ou sur le registre de votre pays d''exercice : la mention « Identité vérifiée » rassure les organisations.
- Vous présentez votre spécialité, vos sujets d''intervention et vos **publications**, importables depuis votre compte ORCID.
- Vous choisissez ce que voient le public, les organisations et les membres de KolBase : coordonnées, activité, collaborations.

## Des sollicitations complètes

Chaque sollicitation arrive avec son objet, ses dates, le temps demandé et les honoraires proposés. Vous acceptez, déclinez ou posez une question directement dans le dossier. Les appels à candidatures ouverts sont réunis dans [Opportunités](/opportunites).

## Les formalités prises en charge

- La **convention** est préparée par l''organisation et se signe en ligne.
- Vos **notes d''honoraires** sont établies à partir de la convention et de votre structure de facturation.
- La rubrique [Revenus](/revenus) tient à jour vos **liens d''intérêts** et ce que les organisations déclarent sur Transparence Santé.

## Comment se référencer

Depuis [Mon compte](/compte), renseignez votre identifiant professionnel, cliquez sur « Me référencer comme expert » et complétez votre fiche. Le référencement est gratuit, révocable à tout moment, et votre fiche n''est jamais vendue.', NULL, now(), now()),
  ('art-collaboration-conforme', 'organisations-une-collaboration-conforme-de-la-sollicitation-a-la-declaration', 'Réglementation', 'Organisations : une collaboration conforme, de la sollicitation à la déclaration', 'Choisir un expert, fixer une juste rémunération, conclure la convention, la soumettre à l''ordre puis la déclarer sur Transparence Santé : les étapes d''une collaboration avec un chirurgien-dentiste, et ce que KolBase prend en charge à chacune.', 'Le Code de la santé publique interdit en principe aux entreprises du secteur de la santé d''offrir des avantages aux professionnels de santé (article L.1453-5). Les collaborations restent possibles dans un cadre précis : une convention écrite, une rémunération proportionnée au travail fourni, une déclaration ou une autorisation préalable, puis la publication sur Transparence Santé.

## 1. Choisir l''expert

Dans l''annuaire, les profils affichent la spécialité, les publications et la mention « Identité vérifiée » lorsque le RPPS a été contrôlé. Les collaborations passées, quand l''expert les rend visibles, vous aident à repérer un conflit d''intérêts avant de solliciter.

## 2. Solliciter avec un objet et une rémunération clairs

Le dossier de collaboration précise l''objet, les dates, le temps de travail et les honoraires. KolBase affiche un repère indicatif d''honoraires pour chaque type de collaboration, et la relecture assistée signale un montant hors de la fourchette ; la juste contrepartie reste documentée par votre organisation.

## 3. Conclure la convention

La convention reprend les éléments du dossier ; elle se signe en ligne ou sur papier. Avant son exécution, elle est déclarée à l''ordre professionnel ou, au-delà des seuils fixés par arrêté, soumise à son autorisation (articles L.1453-8 à L.1453-11). L''équipe conformité de votre organisation peut relire chaque dossier avant validation.

## 4. Organiser l''événement

Les hospitalités offertes aux participants (repas, hébergement, transport) sont enregistrées avec leur valeur au moment de l''inscription, et rapprochées du pointage à l''accueil.

## 5. Déclarer sur Transparence Santé

Deux fois par an, l''espace Conformité prépare le fichier du semestre : conventions, rémunérations et avantages, une ligne par déclaration, avec les libellés de la plateforme publique. Votre équipe le relit puis le dépose.

KolBase est une aide à la conformité : la responsabilité des déclarations reste celle de l''organisation. Pour découvrir l''outil sur l''un de vos dossiers, écrivez-nous à contact@kolbase.io.', NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
