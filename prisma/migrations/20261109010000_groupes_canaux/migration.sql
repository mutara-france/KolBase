-- Lot 9 (groupes et entités) : groupes d'organisations, périmètre des entités, canaux par sujet, aiguillage des
-- propositions, idées de produit.
CREATE TABLE "OrgGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Organization" ADD COLUMN "groupId" TEXT, ADD COLUMN "coveredCountries" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "brands" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrgGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ContactChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "backupId" TEXT,
    "responseDays" INTEGER NOT NULL DEFAULT 10,
    "ipPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactChannel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactChannel_organizationId_topic_key" ON "ContactChannel"("organizationId", "topic");
ALTER TABLE "ContactChannel" ADD CONSTRAINT "ContactChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "channelId" TEXT, ADD COLUMN "responseDue" TIMESTAMP(3);
ALTER TABLE "Project" ADD CONSTRAINT "Project_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ContactChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExpertProposal" ADD COLUMN "topic" TEXT, ADD COLUMN "ipAckAt" TIMESTAMP(3), ADD COLUMN "ndaRequested" BOOLEAN NOT NULL DEFAULT false;
