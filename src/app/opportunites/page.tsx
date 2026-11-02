import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { COLLAB_TYPES, collabType } from "@/lib/projects";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Opportunités")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const user = await requireUser();
  if (!user.practitioner?.listed) redirect("/compte?annuaire=1");
  const { type = "", q = "" } = await searchParams;
  const { t, locale } = await getT();
  const now = new Date();
  const calls = await db.openCall.findMany({
    where: {
      status: "open",
      OR: [{ deadline: null }, { deadline: { gte: now } }],
      ...(type ? { typeId: type } : {}),
      ...(q.trim()
        ? { AND: [{ OR: [{ title: { contains: q.trim(), mode: "insensitive" } }, { specialty: { contains: q.trim(), mode: "insensitive" } }, { description: { contains: q.trim(), mode: "insensitive" } }] }] }
        : {}),
    },
    include: {
      organization: { select: { name: true } },
      applications: { where: { practitionerId: user.practitioner.id }, select: { status: true } },
    },
    orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={practitionerSectionTabs("opportunites").map((tab) => ({ ...tab, label: t(tab.label) }))} active="appels" label={t("Rubrique Opportunités")} />
        <div>
          <h1>{t("Appels ouverts")}</h1>
          <p className="muted">{t("Appels ouverts publiés par les organisations. Candidatez à ceux qui correspondent à votre expertise.")}</p>
        </div>
        <form className="card form search">
          <div className="row">
            <label>{t("Recherche")}<input name="q" defaultValue={q} placeholder={t("Spécialité, ville, sujet…")} /></label>
            <label>{t("Type")}
              <select name="type" defaultValue={type}>
                <option value="">{t("Tous")}</option>
                {COLLAB_TYPES.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
              </select>
            </label>
          </div>
          <button className="btn">{t("Filtrer")}</button>
        </form>
        {calls.length === 0 && <p className="muted">{t("Aucune opportunité ouverte pour ces critères.")}</p>}
        <div className="grid">
          {calls.map((c) => (
            <Link key={c.id} href={`/opportunites/${c.id}`} className="card tile">
              <span className="tag">{t(collabType(c.typeId)?.label ?? c.typeId)}</span>
              <strong>{c.title}</strong>
              <span className="muted">{c.organization.name}{c.specialty ? ` · ${t(c.specialty)}` : ""}</span>
              {(c.budgetMinCents != null || c.budgetMaxCents != null) && (
                <span className="muted">{t("Budget {amount} HT", { amount: [c.budgetMinCents, c.budgetMaxCents].filter((x) => x != null).map((x) => fmtEur(locale, x!)).join(" – ") })}</span>
              )}
              <span className="muted">{c.deadline ? t("Jusqu'au {date}", { date: fmtDate(locale, c.deadline) }) : t("Sans date limite")}</span>
              {c.applications.length > 0 && <span className="pill ok">{t("Candidature envoyée")}</span>}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
