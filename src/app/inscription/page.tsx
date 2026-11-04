import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignUpForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Créer un compte")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; profil?: string }> }) {
  const { next, profil } = await searchParams;
  // Déjà connecté : on va directement là où le lien menait.
  if (await getCurrentUser()) redirect(safeNext(next, "/compte"));
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><SignUpForm next={next} organisation={profil === "organisation"} /></main>
    </>
  );
}
