-- Lot 5b : page d'origine (« next ») gardée par le lien de réinitialisation du mot de passe et par le lien de
-- confirmation d'adresse (invitation) : après le lien, retour à cette page.
ALTER TABLE "AuthToken" ADD COLUMN "next" TEXT;
