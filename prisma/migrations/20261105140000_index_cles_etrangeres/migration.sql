-- Index des clés étrangères : PostgreSQL n'en crée pas automatiquement. Sans eux, chaque page de l'espace connecté
-- (pastilles de l'en-tête : dossiers, événements, sollicitations de l'organisation ou de l'expert), les fiches publiques
-- et les suppressions en cascade parcourent des tables entières, de plus en plus lentement à mesure qu'elles grandissent.

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "Follow_practitionerId_idx" ON "Follow"("practitionerId");

-- CreateIndex
CREATE INDEX "Follow_organizationId_idx" ON "Follow"("organizationId");

-- CreateIndex
CREATE INDEX "PractitionerStructure_practitionerId_idx" ON "PractitionerStructure"("practitionerId");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- CreateIndex
CREATE INDEX "Mandate_mandatorId_idx" ON "Mandate"("mandatorId");

-- CreateIndex
CREATE INDEX "Mandate_agencyId_idx" ON "Mandate"("agencyId");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "Material_projectId_idx" ON "Material"("projectId");

-- CreateIndex
CREATE INDEX "ProjectExpert_practitionerId_idx" ON "ProjectExpert"("practitionerId");

-- CreateIndex
CREATE INDEX "Document_projectExpertId_idx" ON "Document"("projectExpertId");

-- CreateIndex
CREATE INDEX "Message_projectId_idx" ON "Message"("projectId");

-- CreateIndex
CREATE INDEX "Message_projectExpertId_idx" ON "Message"("projectExpertId");

-- CreateIndex
CREATE INDEX "Expense_projectId_idx" ON "Expense"("projectId");

-- CreateIndex
CREATE INDEX "Event_organizationId_startsAt_idx" ON "Event"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

-- CreateIndex
CREATE INDEX "Event_agencyId_idx" ON "Event"("agencyId");

-- CreateIndex
CREATE INDEX "Event_projectId_idx" ON "Event"("projectId");

-- CreateIndex
CREATE INDEX "Rfq_organizationId_idx" ON "Rfq"("organizationId");

-- CreateIndex
CREATE INDEX "Rfq_eventId_idx" ON "Rfq"("eventId");

-- CreateIndex
CREATE INDEX "RfqSupplier_supplierId_idx" ON "RfqSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "Quote_supplierId_idx" ON "Quote"("supplierId");

-- CreateIndex
CREATE INDEX "EventBenefit_eventId_idx" ON "EventBenefit"("eventId");

-- CreateIndex
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");

-- CreateIndex
CREATE INDEX "Registration_sourceOrderId_idx" ON "Registration"("sourceOrderId");

-- CreateIndex
CREATE INDEX "RegistrationBenefit_benefitId_idx" ON "RegistrationBenefit"("benefitId");

-- CreateIndex
CREATE INDEX "OpenCall_organizationId_idx" ON "OpenCall"("organizationId");

-- CreateIndex
CREATE INDEX "Application_practitionerId_idx" ON "Application"("practitionerId");

-- CreateIndex
CREATE INDEX "SupplierReview_clientId_idx" ON "SupplierReview"("clientId");

-- CreateIndex
CREATE INDEX "ServiceOrder_eventId_idx" ON "ServiceOrder"("eventId");
