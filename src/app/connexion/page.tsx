import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignInForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Connexion")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Déjà connecté : on va directement là où le lien menait.
  if (await getCurrentUser()) redirect(safeNext(next, "/compte"));
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><SignInForm next={next} /></main>
    </>
  );
}
