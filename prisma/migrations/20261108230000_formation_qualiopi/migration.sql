-- Lot 6 (plusieurs jours et formation) : fiche de formation, demi-journées et émargement, évaluation des acquis,
-- auto-positionnement, mentions de l'organisme de formation.
ALTER TABLE "Organization" ADD COLUMN "nda" TEXT, ADD COLUMN "qualiopi" TEXT, ADD COLUMN "handicapContact" TEXT;
ALTER TABLE "Registration" ADD COLUMN "assessment" TEXT, ADD COLUMN "assessedAt" TIMESTAMP(3);
ALTER TABLE "SurveyResponse" ADD COLUMN "selfBefore" INTEGER, ADD COLUMN "selfAfter" INTEGER;

CREATE TABLE "TrainingSheet" (
    "eventId" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "audience" TEXT,
    "prerequisites" TEXT,
    "hours" DOUBLE PRECISION,
    "methods" TEXT,
    "assessment" TEXT,
    "accessDelay" TEXT,
    "accessibility" TEXT,
    "price" TEXT,
    "funding" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fundingNote" TEXT,
    "dpcRef" TEXT,
    "contact" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingSheet_pkey" PRIMARY KEY ("eventId")
);
ALTER TABLE "TrainingSheet" ADD CONSTRAINT "TrainingSheet_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventSession_eventId_startsAt_idx" ON "EventSession"("eventId", "startsAt");
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "byId" TEXT,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Attendance_sessionId_registrationId_key" ON "Attendance"("sessionId", "registrationId");
CREATE INDEX "Attendance_registrationId_idx" ON "Attendance"("registrationId");
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
