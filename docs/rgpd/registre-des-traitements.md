# Registre des activités de traitement — KolBase

Éditeur : MUTARA (SAS), 20 rue Léon Martine, 92290 Châtenay-Malabry, RCS Nanterre 927 839 134.
Contact données personnelles : contact@kolbase.io. Version de travail du 3 novembre 2026, **à relire avec un conseil**.

KolBase intervient à deux titres :

- **responsable de traitement** pour la plateforme elle-même (comptes, annuaire des experts, sécurité) ;
- **sous-traitant** des organisations clientes pour les données qu'elles traitent dans leur espace (dossiers,
  conventions, événements, déclarations) : voir le contrat de sous-traitance (`/sous-traitance`).

## 1. KolBase responsable de traitement

| Traitement | Finalité | Base légale | Personnes | Données | Destinataires | Conservation |
|---|---|---|---|---|---|---|
| Comptes | Accès au service, authentification | Contrat (CGU) | Utilisateurs | Identité, e-mail, téléphone, mot de passe haché, préférences | Éditeur | Durée d'utilisation, puis 3 ans |
| Annuaire des experts | Mise en relation praticiens / organisations | Consentement (référencement révocable) | Praticiens référencés | Profession, RPPS ou identifiant étranger, spécialité, lieu d'exercice, présentation, photo (facultative, réencodée sans métadonnées), publications, tarifs indicatifs, visibilité | Membres d'organisations, public selon réglages | Jusqu'au retrait du référencement ; photo : jusqu'à son retrait ou la suppression du compte |
| Photo pour la communication des interventions | Annonce des interventions d'un expert (programme, affiches, réseaux sociaux, e-mailing) | Consentement (case à cocher, révocable) | Praticiens référencés ayant donné leur accord | Photo grand format | Organisations avec qui l'expert collabore, équipe KolBase | Jusqu'au retrait de l'accord ou de la photo |
| Projets proposés par les experts | Soumettre un projet à des organisations choisies par l'expert (cinq au plus) | Contrat (CGU) | Praticiens référencés | Titre, objectif, public, calendrier, honoraires souhaités, pièce jointe éventuelle | Organisations destinataires (chacune sa copie) | Proposition : jusqu'à la suppression du compte ; copie reçue : dossier de l'organisation |
| Vérification des identités | Fiabilité de l'annuaire et des organisations | Intérêt légitime | Praticiens, organisations | RPPS (Annuaire Santé public), SIREN (répertoire des entreprises) | Administrateurs KolBase | Durée du compte |
| Sécurité et traçabilité | Prévention des abus, preuve des actions sensibles | Intérêt légitime, obligation légale des organisations | Utilisateurs | Journal des actions, sessions (jeton haché, navigateur), tentatives de connexion | Éditeur, organisation concernée | Sessions expirées : 30 jours ; journal : durée de la relation |
| Surveillance technique | Disponibilité, correction des erreurs | Intérêt légitime | Utilisateurs | Adresse de la page, message d'erreur (pas de contenu de formulaire) | Administrateurs KolBase | Journaux de l'hébergeur |
| Notifications | Informer des actions attendues | Contrat | Utilisateurs | E-mail, nom, objet de la notification | Prestataire d'e-mails | Le temps de l'envoi |

## 2. KolBase sous-traitant des organisations

| Traitement (pour le compte de l'organisation) | Personnes | Données | Sous-traitants ultérieurs |
|---|---|---|---|
| Sollicitation et conventionnement d'experts, validation des dossiers | Experts, membres | Identité, RPPS, honoraires, échanges, documents, signature | Hébergeur, stockage des documents, signature électronique |
| Notes d'honoraires | Experts | Coordonnées de facturation (adresse, SIRET, TVA, IBAN) | Hébergeur |
| Événements, inscriptions, hospitalités | Inscrits | Identité, profession, structure, prestations acceptées et valeurs | Hébergeur, e-mails |
| Pointage, attestations, questionnaires | Inscrits | Heure d'arrivée, code de vérification, réponses (anonymes pour l'organisateur) | Hébergeur, e-mails |
| Préparation des déclarations (Transparence Santé, encadrement des avantages) | Experts, inscrits | Montants, dates, objet, identifiant professionnel | Hébergeur |
| Statistiques internes | Experts, inscrits | Données agrégées des dossiers et événements | Hébergeur |
| Assistant d'IA (à la demande) | Experts, intervenants | Nom, spécialité, honoraires, liens d'intérêts connus, selon l'usage | Anthropic (États-Unis) — transfert hors UE à encadrer |

## 3. Sous-traitants ultérieurs

| Prestataire | Rôle | Localisation |
|---|---|---|
| Render | Hébergement de l'application et de la base PostgreSQL | Francfort (UE) |
| LWS (Ligne Web Services) | Envoi des e-mails | Paris (UE) |
| À désigner (`S3_*`) | Stockage des documents des dossiers | UE |
| Youtrust (anciennement Yousign) | Signature électronique des conventions (facultatif) | Caen (UE) |
| Anthropic | Assistant d'IA (facultatif, à la demande) | États-Unis |

## 4. Mesures de sécurité

Hébergement dans l'UE, HTTPS, base sur réseau privé, mots de passe hachés (scrypt), jetons et liens stockés hachés,
limitation des tentatives de connexion, cloisonnement par organisation et par rôle, double validation des dossiers,
journal des actions sensibles, documents privés servis par liens temporaires, en-têtes de sécurité, alertes
d'erreur, sauvegardes de l'hébergeur.

## 5. À compléter avec un conseil

- Mécanisme de transfert hors UE pour l'assistant d'IA (clauses contractuelles types, cadre de protection des données).
- Durées de conservation des conventions et pièces justificatives selon les obligations des organisations.
- Analyse d'impact (AIPD) : à évaluer au regard du volume de professionnels de santé et du croisement de données.
