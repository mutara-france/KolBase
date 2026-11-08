import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Route } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { country } from "@/lib/countries";
import { topicLabel, TOPICS } from "@/lib/routing";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await db.orgGroup.findUnique({ where: { id }, select: { name: true } });
  return { title: g ? `${g.name} — KolBase` : "KolBase" };
}

/**
 * Portail d'un groupe : ses entités (pays couverts, marques) et, pour chaque sujet, le délai de réponse annoncé. Un
 * expert propose son projet au groupe : il est transmis à l'entité de son pays, à la personne en charge du sujet.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, { t }] = await Promise.all([getCurrentUser(), getT()]);
  const g = await db.orgGroup.findUnique({
    where: { id },
    include: { entities: { where: { listed: true, verification: "VERIFIED" }, select: { id: true, name: true, coveredCountries: true, brands: true, channels: { select: { topic: true, responseDays: true } } }, orderBy: { name: "asc" } } },
  });
  if (!g || g.entities.length === 0) notFound();
  const topics = TOPICS.filter((x) => g.entities.some((e) => e.channels.some((c) => c.topic === x.id)));
  const canPropose = !!user?.practitioner?.listed;
  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={`stack${user ? "" : " landing"}`}>
        <div>
          <h1>{g.name}</h1>
          {g.about && <p className="muted">{g.about}</p>}
          <p className="muted">{t("Proposez votre projet au groupe : il est transmis à l'entité de votre pays, à la personne en charge du sujet, avec un délai de réponse annoncé.")}</p>
        </div>
        <section className="card stack-sm" aria-labelledby="sujets-titre">
          <SectionHead icon={Route} id="sujets-titre" title={t("Sujets")} />
          {topics.length === 0 ? <p className="muted text-sm">{t("Les propositions sont examinées par l'équipe de chaque entité.")}</p> : (
            <ul className="plain stack-xs">
              {topics.map((x) => {
                const days = g.entities.flatMap((e) => e.channels.filter((c) => c.topic === x.id).map((c) => c.responseDays));
                return (
                  <li key={x.id} className="flex-between">
                    <span>{t(x.label)} <span className="text-sm muted">· {t(Math.max(...days) > 1 ? "réponse sous {n} jours" : "réponse sous {n} jour", { n: Math.max(...days) })}</span></span>
                    {canPropose && <Link className="btn ghost small" href={`/propositions/nouvelle?groupe=${g.id}&sujet=${x.id}`}>{t("Proposer")}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
          {canPropose ? <Link className="btn small" href={`/propositions/nouvelle?groupe=${g.id}`}>{t("Proposer un projet")}</Link>
            : !user ? <Link className="btn ghost small" href={`/connexion?next=${encodeURIComponent(`/groupes/${g.id}`)}`}>{t("Se connecter pour proposer un projet")}</Link>
            : <p className="hint">{t("Réservé aux experts référencés.")}</p>}
        </section>
        <section className="card stack-sm" aria-labelledby="entites-titre">
          <SectionHead icon={Building2} id="entites-titre" title={t("Entités")} />
          <ul className="plain stack-sm">
            {g.entities.map((e) => (
              <li key={e.id}>
                <Link href={`/structures/${e.id}`}><strong>{e.name}</strong></Link>
                <div className="text-sm muted">
                  {[e.coveredCountries.length ? e.coveredCountries.map((c) => t(country(c).name)).join(", ") : t("siège (autres pays)"), e.brands.length ? e.brands.join(", ") : null, e.channels.length ? e.channels.map((c) => t(topicLabel(c.topic))).join(", ") : null].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
