-- Lot 4 (invitations et logistique) : événements sur invitation, congrès d'un tiers, voyages, budget.
ALTER TABLE "Event" ADD COLUMN "inviteOnly" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "hostedBy" TEXT, ADD COLUMN "hostedUrl" TEXT;

CREATE TABLE "EventInvite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "userId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdById" TEXT,
    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventInvite_tokenHash_key" ON "EventInvite"("tokenHash");
CREATE UNIQUE INDEX "EventInvite_eventId_email_key" ON "EventInvite"("eventId", "email");
CREATE INDEX "EventInvite_eventId_idx" ON "EventInvite"("eventId");
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RegistrationTravel" (
    "registrationId" TEXT NOT NULL,
    "departureCity" TEXT,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "roomType" TEXT,
    "hotel" TEXT,
    "hotelRef" TEXT,
    "outbound" TEXT,
    "returnTrip" TEXT,
    "ticketRef" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationTravel_pkey" PRIMARY KEY ("registrationId")
);
ALTER TABLE "RegistrationTravel" ADD CONSTRAINT "RegistrationTravel_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventBudgetLine" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "plannedCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventBudgetLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventBudgetLine_eventId_idx" ON "EventBudgetLine"("eventId");
ALTER TABLE "EventBudgetLine" ADD CONSTRAINT "EventBudgetLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
