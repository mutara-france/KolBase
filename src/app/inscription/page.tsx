import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignUpForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Créer un compte")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/compte");
  const { next } = await searchParams;
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><SignUpForm next={next} /></main>
    </>
  );
}
