-- Lot 7 (congrès et associations) : programme en salles, partenaires, appel à communications et relecture.
ALTER TABLE "Event" ADD COLUMN "abstractsDeadline" TIMESTAMP(3), ADD COLUMN "abstractTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "EventRoom" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EventRoom_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventRoom_eventId_idx" ON "EventRoom"("eventId");
ALTER TABLE "EventRoom" ADD CONSTRAINT "EventRoom_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventPartner" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "amountCents" INTEGER,
    "counterparts" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "proposedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signedById" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declineNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventPartner_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventPartner_eventId_idx" ON "EventPartner"("eventId");
CREATE INDEX "EventPartner_organizationId_idx" ON "EventPartner"("organizationId");
ALTER TABLE "EventPartner" ADD CONSTRAINT "EventPartner_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPartner" ADD CONSTRAINT "EventPartner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Abstract" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topic" TEXT,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "acceptedFormat" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Abstract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Abstract_eventId_idx" ON "Abstract"("eventId");
CREATE INDEX "Abstract_userId_idx" ON "Abstract"("userId");
ALTER TABLE "Abstract" ADD CONSTRAINT "Abstract_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Abstract" ADD CONSTRAINT "Abstract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AbstractReview" (
    "id" TEXT NOT NULL,
    "abstractId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AbstractReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AbstractReview_abstractId_reviewerId_key" ON "AbstractReview"("abstractId", "reviewerId");
ALTER TABLE "AbstractReview" ADD CONSTRAINT "AbstractReview_abstractId_fkey" FOREIGN KEY ("abstractId") REFERENCES "Abstract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProgramItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roomId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "speakers" TEXT,
    "partnerId" TEXT,
    "abstractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProgramItem_abstractId_key" ON "ProgramItem"("abstractId");
CREATE INDEX "ProgramItem_eventId_startsAt_idx" ON "ProgramItem"("eventId", "startsAt");
ALTER TABLE "ProgramItem" ADD CONSTRAINT "ProgramItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramItem" ADD CONSTRAINT "ProgramItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "EventRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgramItem" ADD CONSTRAINT "ProgramItem_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "EventPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgramItem" ADD CONSTRAINT "ProgramItem_abstractId_fkey" FOREIGN KEY ("abstractId") REFERENCES "Abstract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
