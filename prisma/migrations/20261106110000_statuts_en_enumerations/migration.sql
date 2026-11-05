-- Statuts des abonnements et des services : texte libre converti en énumérations, avec les mêmes valeurs.
-- Aucune donnée réécrite. La version précédente, encore en service pendant le déploiement, continue de lire et
-- d'écrire ces colonnes (le pilote transmet des paramètres non typés, que PostgreSQL convertit).

-- Valeur imprévue : arrêt avec un message qui la nomme (le déploiement est alors annulé, l'ancienne version reste).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT v, ', ') INTO bad FROM (
    SELECT 'Subscription.plan = ' || "plan" AS v FROM "Subscription" WHERE "plan" NOT IN ('organisation', 'prestataire')
    UNION ALL SELECT 'Subscription.interval = ' || "interval" FROM "Subscription" WHERE "interval" NOT IN ('month', 'year')
    UNION ALL SELECT 'Subscription.status = ' || "status" FROM "Subscription" WHERE "status" NOT IN ('a_activer', 'essai', 'active', 'impayee', 'resiliee')
    UNION ALL SELECT 'ServiceOffer.kind = ' || "kind" FROM "ServiceOffer" WHERE "kind" NOT IN ('newsletter', 'social', 'une', 'pack', 'autre')
    UNION ALL SELECT 'ServiceOrder.status = ' || "status" FROM "ServiceOrder" WHERE "status" NOT IN ('demandee', 'planifiee', 'realisee', 'refusee', 'annulee')
  ) t;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Valeurs à corriger avant la conversion en énumérations : %', bad;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('organisation', 'prestataire');
CREATE TYPE "BillingInterval" AS ENUM ('month', 'year');
CREATE TYPE "SubscriptionStatus" AS ENUM ('a_activer', 'essai', 'active', 'impayee', 'resiliee');
CREATE TYPE "ServiceKind" AS ENUM ('newsletter', 'social', 'une', 'pack', 'autre');
CREATE TYPE "ServiceOrderStatus" AS ENUM ('demandee', 'planifiee', 'realisee', 'refusee', 'annulee');

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "interval" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "plan" SET DATA TYPE "SubscriptionPlan" USING "plan"::"SubscriptionPlan";
ALTER TABLE "Subscription" ALTER COLUMN "interval" SET DATA TYPE "BillingInterval" USING "interval"::"BillingInterval";
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DATA TYPE "SubscriptionStatus" USING "status"::"SubscriptionStatus";
ALTER TABLE "Subscription" ALTER COLUMN "interval" SET DEFAULT 'month';
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'a_activer';

ALTER TABLE "ServiceOffer" ALTER COLUMN "kind" SET DATA TYPE "ServiceKind" USING "kind"::"ServiceKind";

ALTER TABLE "ServiceOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ServiceOrder" ALTER COLUMN "status" SET DATA TYPE "ServiceOrderStatus" USING "status"::"ServiceOrderStatus";
ALTER TABLE "ServiceOrder" ALTER COLUMN "status" SET DEFAULT 'demandee';
