-- Pointage à l'accueil des événements : badge (QR) et heure d'arrivée.
ALTER TABLE "Registration" ADD COLUMN "checkinCode" TEXT;
ALTER TABLE "Registration" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "checkedInById" TEXT;
CREATE UNIQUE INDEX "Registration_checkinCode_key" ON "Registration"("checkinCode");
