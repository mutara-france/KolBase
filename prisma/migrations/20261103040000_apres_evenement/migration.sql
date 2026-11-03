-- Après l'événement : rappel de la veille, attestation de présence vérifiable, questionnaire de satisfaction.
ALTER TABLE "Registration" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "followUpSentAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "certificateCode" TEXT;
CREATE UNIQUE INDEX "Registration_certificateCode_key" ON "Registration"("certificateCode");

CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "content" INTEGER,
    "logistics" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyResponse_registrationId_key" ON "SurveyResponse"("registrationId");
CREATE INDEX "SurveyResponse_eventId_idx" ON "SurveyResponse"("eventId");
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
