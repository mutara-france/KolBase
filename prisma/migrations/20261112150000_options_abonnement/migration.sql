-- Options de l'abonnement organisation (KolBase Intelligence, KolBase Business) : souscrites ou offertes par KolBase.
CREATE TYPE "SubscriptionAddon" AS ENUM ('intelligence', 'business');

ALTER TABLE "Subscription" ADD COLUMN "addons" "SubscriptionAddon"[] DEFAULT ARRAY[]::"SubscriptionAddon"[],
ADD COLUMN "addonsGranted" "SubscriptionAddon"[] DEFAULT ARRAY[]::"SubscriptionAddon"[];
