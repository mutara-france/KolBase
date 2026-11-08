-- Lot 5 (experts) : notes de frais sur justificatif, billets et hébergement, contrat-cadre et missions.
ALTER TYPE "DocumentKind" ADD VALUE 'JUSTIFICATIF';
ALTER TABLE "Project" ADD COLUMN "framework" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "periodEnd" TIMESTAMP(3);

CREATE TABLE "ExpertExpense" (
    "id" TEXT NOT NULL,
    "projectExpertId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpertExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExpertExpense_projectExpertId_idx" ON "ExpertExpense"("projectExpertId");
ALTER TABLE "ExpertExpense" ADD CONSTRAINT "ExpertExpense_projectExpertId_fkey" FOREIGN KEY ("projectExpertId") REFERENCES "ProjectExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExpertTravel" (
    "projectExpertId" TEXT NOT NULL,
    "hotel" TEXT,
    "hotelRef" TEXT,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "roomType" TEXT,
    "outbound" TEXT,
    "returnTrip" TEXT,
    "ticketRef" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpertTravel_pkey" PRIMARY KEY ("projectExpertId")
);
ALTER TABLE "ExpertTravel" ADD CONSTRAINT "ExpertTravel_projectExpertId_fkey" FOREIGN KEY ("projectExpertId") REFERENCES "ProjectExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FrameworkMission" (
    "id" TEXT NOT NULL,
    "projectExpertId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FrameworkMission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FrameworkMission_projectExpertId_idx" ON "FrameworkMission"("projectExpertId");
ALTER TABLE "FrameworkMission" ADD CONSTRAINT "FrameworkMission_projectExpertId_fkey" FOREIGN KEY ("projectExpertId") REFERENCES "ProjectExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
