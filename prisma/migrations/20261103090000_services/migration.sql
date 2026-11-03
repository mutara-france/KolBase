-- Services additionnels sur les événements, lettre d'information aux membres consentants.
ALTER TABLE "User" ADD COLUMN "unsubscribeToken" TEXT;
CREATE UNIQUE INDEX "User_unsubscribeToken_key" ON "User"("unsubscribeToken");

CREATE TABLE "ServiceOffer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceOffer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceOffer_code_key" ON "ServiceOffer"("code");

CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "brief" TEXT,
    "wishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'demandee',
    "adminNote" TEXT,
    "resultUrl" TEXT,
    "orderedById" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "invoiceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceOrder_organizationId_idx" ON "ServiceOrder"("organizationId");
CREATE INDEX "ServiceOrder_status_idx" ON "ServiceOrder"("status");
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ServiceOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "NewsletterCampaign" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsletterCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsletterCampaign_orderId_key" ON "NewsletterCampaign"("orderId");
ALTER TABLE "NewsletterCampaign" ADD CONSTRAINT "NewsletterCampaign_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Catalogue de départ (prix HT indicatifs, réglables dans /admin › Services).
INSERT INTO "ServiceOffer" ("id", "code", "kind", "label", "description", "priceCents", "position", "updatedAt") VALUES
  ('svc-newsletter', 'newsletter', 'newsletter', 'E-mailing dédié aux membres KolBase', 'Votre événement présenté dans un e-mail dédié, envoyé aux praticiens membres qui ont accepté de recevoir la lettre d''information de KolBase.', 69000, 1, now()),
  ('svc-reseaux', 'reseaux', 'social', 'Publication sur les réseaux sociaux de KolBase', 'Un post rédigé par l''équipe KolBase sur ses comptes LinkedIn et Instagram, avec un lien vers la page d''inscription.', 29000, 2, now()),
  ('svc-une', 'une', 'une', 'À la une de la page d''accueil (7 jours)', 'Votre événement mis en avant en tête de l''agenda de la page d''accueil pendant sept jours.', 19000, 3, now());
