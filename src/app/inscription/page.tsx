import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignUpForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";
import { organisationOrigin, safeNext } from "@/lib/safe-redirect";
import { findInvitation, ORG_KIND_LABEL } from "@/lib/orgs";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Créer un compte")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; profil?: string }> }) {
  const { next, profil } = await searchParams;
  // Déjà connecté : on va directement là où le lien menait.
  if (await getCurrentUser()) redirect(safeNext(next, "/compte"));
  // Venue d'une invitation nominative encore valable : l'adresse invitée est préremplie.
  const token = safeNext(next, "").match(/^\/invitation\/([A-Za-z0-9_-]{20,100})$/)?.[1];
  const inv = token ? await findInvitation(token) : null;
  const invited = inv && !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date() ? inv.email ?? undefined : undefined;
  const { t } = await getT();
  const kinds = Object.entries(ORG_KIND_LABEL).map(([value, label]) => ({ value, label: t(label) }));
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><SignUpForm next={next} organisation={profil === "organisation" || organisationOrigin(next)} email={invited} kinds={kinds} /></main>
    </>
  );
}
