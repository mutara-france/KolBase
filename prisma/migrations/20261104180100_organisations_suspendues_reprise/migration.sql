-- Organisations suspendues avant ce statut, enregistrées « en attente » : la dernière décision de l'équipe KolBase
-- est une suspension (sans nouvelle demande de validation depuis). Elles passent « suspendues » ; leur page publique
-- est rétablie selon la règle de la validation (masquée tant que dure la suspension, rendue à la réactivation).
UPDATE "Organization" o
SET verification = 'SUSPENDED',
    listed = (o.kind <> 'PRESTATAIRE' OR cardinality(o."supplierCategories") > 0)
WHERE o.verification = 'PENDING'
  AND (
    SELECT a.action FROM "AuditLog" a
    WHERE a."entityType" = 'Organization' AND a."entityId" = o.id
      AND a.action IN ('platform.org_verify', 'platform.org_reject', 'platform.org_suspend', 'org.siren')
    ORDER BY a."createdAt" DESC
    LIMIT 1
  ) = 'platform.org_suspend';
