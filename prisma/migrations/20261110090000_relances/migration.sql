-- Relances : sollicitation d'expert restée sans réponse (une relance), signataires en retard (J+3, J+7).
ALTER TABLE "ProjectExpert" ADD COLUMN "reminderSentAt" TIMESTAMP(3),
ADD COLUMN "unansweredAt" TIMESTAMP(3);
ALTER TABLE "ConventionSignature" ADD COLUMN "reminders" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reminderSentAt" TIMESTAMP(3);
