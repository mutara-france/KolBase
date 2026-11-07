-- Validation des événements par la conformité avant publication (lieu, date, programme, hospitalités).
ALTER TABLE "Organization" ADD COLUMN "eventReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "reviewStatus" TEXT;
ALTER TABLE "Event" ADD COLUMN "reviewSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "reviewSubmittedById" TEXT;
ALTER TABLE "Event" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Event" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "Event" ADD COLUMN "reviewChanges" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Industriels (dispositif anti-cadeaux) : validation exigée par défaut. Les événements déjà publiés restent en ligne,
-- considérés comme validés à leur date de publication.
UPDATE "Organization" SET "eventReview" = true WHERE "kind" = 'INDUSTRIEL';
UPDATE "Event" SET "reviewStatus" = 'approved', "reviewedAt" = "publishedAt" WHERE "publishedAt" IS NOT NULL;
