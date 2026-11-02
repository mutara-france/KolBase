-- Un seul type d'appel : l'appel à candidatures, rattaché ou non à un événement.
-- Les appels à intervenants (portés jusqu'ici par l'événement) deviennent des appels rattachés à leur événement,
-- et leurs candidatures rejoignent celles des appels.
ALTER TABLE "OpenCall" ADD COLUMN "eventId" TEXT;
ALTER TABLE "OpenCall" ADD COLUMN "slots" INTEGER;

INSERT INTO "OpenCall" ("id", "organizationId", "title", "specialty", "typeId", "budgetMinCents", "budgetMaxCents", "deadline", "description", "status", "createdAt", "eventId", "slots")
SELECT
  'spk-' || e."id",
  e."organizationId",
  'Intervenants : ' || e."title",
  e."therapeuticArea",
  CASE WHEN e."typeId" IN ('symposium', 'pleniere', 'table-ronde', 'webinaire', 'travaux-pratiques', 'dpc', 'live-surgery') THEN e."typeId" ELSE 'pleniere' END,
  e."speakerBudgetMinCents",
  e."speakerBudgetMaxCents",
  e."speakerDeadline",
  e."speakerProfile",
  CASE WHEN e."speakerCallOpen" THEN 'open'::"OpenCallStatus" ELSE 'closed'::"OpenCallStatus" END,
  e."createdAt",
  e."id",
  e."speakerSlots"
FROM "Event" e
WHERE e."speakerCallOpen" OR e."speakerSlots" IS NOT NULL OR EXISTS (SELECT 1 FROM "SpeakerApplication" s WHERE s."eventId" = e."id");

INSERT INTO "Application" ("id", "openCallId", "practitionerId", "message", "status", "projectId", "createdAt")
SELECT s."id", 'spk-' || s."eventId", s."practitionerId", s."message", s."status", s."projectId", s."createdAt"
FROM "SpeakerApplication" s;

DROP TABLE "SpeakerApplication";

ALTER TABLE "Event" DROP COLUMN "speakerCallOpen",
DROP COLUMN "speakerDeadline",
DROP COLUMN "speakerSlots",
DROP COLUMN "speakerBudgetMinCents",
DROP COLUMN "speakerBudgetMaxCents",
DROP COLUMN "speakerProfile";

CREATE INDEX "OpenCall_eventId_idx" ON "OpenCall"("eventId");

ALTER TABLE "OpenCall" ADD CONSTRAINT "OpenCall_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
