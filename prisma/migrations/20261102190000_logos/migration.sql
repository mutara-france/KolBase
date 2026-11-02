-- Logo des organisations.
ALTER TABLE "Organization" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);

CREATE TABLE "OrganizationLogo" (
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLogo_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "OrganizationLogo" ADD CONSTRAINT "OrganizationLogo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
