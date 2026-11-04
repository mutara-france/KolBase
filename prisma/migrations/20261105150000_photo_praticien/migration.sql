-- Photo des praticiens : portrait recadré et réencodé (grand format et vignette), accord pour la communication.
ALTER TABLE "PractitionerProfile" ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
ALTER TABLE "PractitionerProfile" ADD COLUMN "photoConsentAt" TIMESTAMP(3);

CREATE TABLE "PractitionerPhoto" (
    "practitionerId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PractitionerPhoto_pkey" PRIMARY KEY ("practitionerId")
);

ALTER TABLE "PractitionerPhoto" ADD CONSTRAINT "PractitionerPhoto_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "PractitionerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
