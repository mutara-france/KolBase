import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Page introuvable — KolBase"), robots: { index: false } };
}

export default async function NotFound() {
  const { t } = await getT();
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow stack">
        <section className="card form">
          <h1>{t("Page introuvable")}</h1>
          <p className="muted">{t("Cette page n'existe pas, a été retirée, ou vous n'y avez pas accès.")}</p>
          <div className="actions">
            <Link className="btn" href="/">{t("Accueil")}</Link>
            <Link className="btn ghost" href="/experts">{t("Experts")}</Link>
            <Link className="btn ghost" href="/evenements">{t("Événements")}</Link>
          </div>
        </section>
      </main>
    </>
  );
}
