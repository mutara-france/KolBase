-- La conformité devient réservée au rôle Conformité (l'administrateur n'en a plus l'accès d'office).
-- Pour ne bloquer aucune organisation cliente, celles qui n'ont encore aucun membre Conformité donnent ce rôle à leurs
-- administrateurs ; ils pourront le retirer (Membres et réglages) quand un collègue le reprendra.
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "createdAt")
SELECT 'mig-conf-' || md5(m."userId" || m."organizationId"), m."userId", m."organizationId", 'CONFORMITE', CURRENT_TIMESTAMP
FROM "Membership" m
JOIN "Organization" o ON o."id" = m."organizationId"
WHERE m."role" = 'ADMIN'
  AND o."kind" <> 'PRESTATAIRE'
  AND NOT EXISTS (SELECT 1 FROM "Membership" c WHERE c."organizationId" = m."organizationId" AND c."role" = 'CONFORMITE')
ON CONFLICT ("userId", "organizationId", "role") DO NOTHING;
