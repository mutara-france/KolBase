-- Attestation de signature lorsque la convention signée ne peut pas être déposée sur KolBase.
ALTER TABLE "Project" ADD COLUMN "signatureAttestedAt" TIMESTAMP(3),
ADD COLUMN "signatureAttestedById" TEXT;
