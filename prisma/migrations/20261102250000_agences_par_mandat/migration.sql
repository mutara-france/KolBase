-- Agences mandatées : l'accès d'une agence à une organisation cliente découle désormais du mandat actif
-- (les membres de l'agence y obtiennent le rôle « Agence mandatée »). Les anciens rattachements individuels
-- avec ce rôle dans une organisation cliente n'avaient d'effet qu'à travers l'agence : ils sont retirés.
DELETE FROM "Membership" m USING "Organization" o
WHERE m."organizationId" = o.id AND o.kind <> 'PRESTATAIRE' AND m.role = 'PRESTATAIRE';

DELETE FROM "Invitation" i USING "Organization" o
WHERE i."organizationId" = o.id AND o.kind <> 'PRESTATAIRE' AND i.role = 'PRESTATAIRE' AND i."acceptedAt" IS NULL;
