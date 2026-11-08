-- Administration : comptes désactivables par l'équipe KolBase, journal d'activité consultable (index).
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3), ADD COLUMN "disabledNote" TEXT;
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
