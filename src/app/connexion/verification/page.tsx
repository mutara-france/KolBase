import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SecondFactorForm } from "@/components/TwoFactorForms";
import { findToken } from "@/lib/tokens";
import { PENDING_COOKIE } from "@/lib/two-factor";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Vérification en deux étapes")} — KolBase`, robots: { index: false } };
}

/** Seconde étape de la connexion : seulement après un mot de passe correct (jeton d'étape valable 10 minutes). */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const pending = await findToken((await cookies()).get(PENDING_COOKIE)?.value ?? "", "TWO_FACTOR");
  if (!pending) redirect(`/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><SecondFactorForm next={next} /></main>
    </>
  );
}
