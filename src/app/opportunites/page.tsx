import { PageHead } from "@/components/UI";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { callFull, COLLAB_TYPES, collabType } from "@/lib/projects";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { ActiveFilters, FilterSelect } from "@/components/Filters";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Opportunités")} — KolBase` };
}

type Search = { type?: string; q?: string; evenement?: string; specialite?: string; ville?: string; candidature?: string; tri?: string };

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!user.practitioner?.listed) redirect("/compte?candidater=1#referencement");
  const { type = "", q = "", evenement = "", specialite = "", ville = "", candidature = "", tri = "" } = await searchParams;
  const { t, locale } = await getT();
  const now = new Date();
  const open = {
    status: "open" as const,
    organization: { verification: "VERIFIED" as const },
    AND: [{ OR: [{ deadline: null }, { deadline: { gte: now } }] }, { OR: [{ eventId: null }, { event: { startsAt: { gte: now } } }] }],
  };
  // Valeurs proposées dans les filtres : celles des opportunités ouvertes.
  const facets = await db.openCall.findMany({ where: open, select: { specialty: true, typeId: true, event: { select: { city: true } } } });
  const specialties = [...new Set(facets.map((f) => f.specialty).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "fr"));
  const cities = [...new Set(facets.map((f) => f.event?.city).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "fr"));
  const types = COLLAB_TYPES.filter((x) => facets.some((f) => f.typeId === x.id));
  const mine = user.practitioner.specialty;
  const calls = await db.openCall.findMany({
    where: {
      status: "open",
      organization: { verification: "VERIFIED" },
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: now } }] },
        // Un appel rattaché à un événement passé n'est plus d'actualité.
        { OR: [{ eventId: null }, { event: { startsAt: { gte: now } } }] },
        ...(q.trim() ? [{ OR: [{ title: { contains: q.trim(), mode: "insensitive" as const } }, { specialty: { contains: q.trim(), mode: "insensitive" as const } }, { description: { contains: q.trim(), mode: "insensitive" as const } }] }] : []),
      ],
      ...(evenement === "avec" ? { eventId: { not: null } } : evenement === "sans" ? { eventId: null } : {}),
      ...(type ? { typeId: type } : {}),
      ...(specialite ? { specialty: specialite } : {}),
      ...(ville ? { event: { city: ville } } : {}),
      ...(candidature === "sans" ? { applications: { none: { practitionerId: user.practitioner.id } } } : candidature === "avec" ? { applications: { some: { practitionerId: user.practitioner.id } } } : {}),
    },
    include: {
      organization: { select: { name: true } },
      event: { select: { title: true, startsAt: true, city: true, format: true } },
      applications: { where: { practitionerId: user.practitioner.id }, select: { status: true } },
      // Places pourvues : l'appel est affiché « Complet ».
      _count: { select: { applications: { where: { status: "retained" } } } },
    },
    // Tri : échéance la plus proche (par défaut), plus récentes, ou budget le plus élevé.
    orderBy: tri === "recentes" ? [{ createdAt: "desc" }] : tri === "budget" ? [{ budgetMaxCents: { sort: "desc", nulls: "last" } }, { deadline: "asc" }] : [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
  });
  const params = { q, type, evenement, specialite, ville, candidature, tri };
  const typeLabel = (id: string) => t(collabType(id)?.label ?? id);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={practitionerSectionTabs("opportunites").map((tab) => ({ ...tab, label: t(tab.label) }))} active="appels" label={t("Rubrique Opportunités")} />
        <PageHead title={t("Opportunités")} desc={t("Les organisations cherchent des experts pour une collaboration (board, étude, rédaction…) ou pour intervenir à un événement (formation, symposium…). Candidatez : si vous êtes retenu, vous recevez une proposition d'honoraires.")} />
        <form className="filter-bar boxed" role="search" action="/opportunites">
          <label htmlFor="opp-q" className="sr-only">{t("Recherche")}</label>
          <input id="opp-q" name="q" type="search" defaultValue={q} placeholder={t("Spécialité, ville, sujet…")} />
          <FilterSelect name="evenement" label={t("Événement")} value={evenement} all={t("Avec ou sans événement")} options={[{ value: "avec", label: t("Intervenir à un événement") }, { value: "sans", label: t("Collaboration hors événement") }]} />
          <FilterSelect name="type" label={t("Type")} value={type} all={t("Tous les types")} options={types.map((x) => ({ value: x.id, label: t(x.label) }))} />
          {specialties.length > 0 && <FilterSelect name="specialite" label={t("Spécialité")} value={specialite} all={t("Toutes les spécialités")} options={specialties.map((x) => ({ value: x, label: t(x) }))} />}
          {cities.length > 0 && <FilterSelect name="ville" label={t("Ville")} value={ville} all={t("Toutes les villes")} options={cities.map((x) => ({ value: x, label: x }))} />}
          <FilterSelect name="candidature" label={t("Mes candidatures")} value={candidature} all={t("Avec ou sans ma candidature")} options={[{ value: "sans", label: t("Sans ma candidature") }, { value: "avec", label: t("Où j'ai candidaté") }]} />
          <FilterSelect name="tri" label={t("Trier")} value={tri} all={t("Échéance la plus proche")} options={[{ value: "recentes", label: t("Plus récentes") }, { value: "budget", label: t("Budget le plus élevé") }]} />
          <button className="btn">{t("Filtrer")}</button>
        </form>
        <div className="list-meta">
          <span className="muted text-sm">{t(calls.length > 1 ? "{n} opportunités" : "{n} opportunité", { n: calls.length })}</span>
          {mine && specialite !== mine && specialties.includes(mine) && <Link className="chip" href={`/opportunites?${new URLSearchParams(Object.entries({ ...params, specialite: mine }).filter(([, v]) => v))}`}>{t("Ma spécialité : {s}", { s: t(mine) })}</Link>}
        </div>
        <ActiveFilters
          path="/opportunites"
          params={params}
          ariaLabel={t("Filtres actifs")}
          clearLabel={t("Tout effacer")}
          labels={{
            q: q && t("Recherche : {value}", { value: q }),
            evenement: evenement && (evenement === "avec" ? t("Intervenir à un événement") : t("Collaboration hors événement")),
            type: type && t("Type : {value}", { value: typeLabel(type) }),
            specialite: specialite && t("Spécialité : {value}", { value: t(specialite) }),
            ville: ville && t("Ville : {value}", { value: ville }),
            candidature: candidature && (candidature === "sans" ? t("Sans ma candidature") : t("Où j'ai candidaté")),
            tri: tri && (tri === "recentes" ? t("Plus récentes") : t("Budget le plus élevé")),
          }}
        />
        {calls.length === 0 && <p className="muted">{t("Aucune opportunité ouverte pour ces critères.")}</p>}
        <div className="grid">
          {calls.map((c) => (
            <Link key={c.id} href={`/opportunites/${c.id}`} className="card tile">
              <span className="tag">{t(collabType(c.typeId)?.label ?? c.typeId)}</span>
              <strong>{c.title}</strong>
              {c.event && <span className="pill electric">{t("Intervention le {date}", { date: fmtDate(locale, c.event.startsAt) })}{c.event.city ? ` · ${c.event.city}` : ""}</span>}
              <span className="muted">{c.organization.name}{c.specialty ? ` · ${t(c.specialty)}` : ""}</span>
              {(c.budgetMinCents != null || c.budgetMaxCents != null) && (
                <span className="muted">{t("Budget {amount} HT", { amount: [c.budgetMinCents, c.budgetMaxCents].filter((x) => x != null).map((x) => fmtEur(locale, x!)).join(" – ") })}</span>
              )}
              <span className="muted">{c.deadline ? t("Jusqu'au {date}", { date: fmtDate(locale, c.deadline) }) : t("Sans date limite")}</span>
              {c.applications.length > 0 ? <span className="pill ok">{t("Candidature envoyée")}</span> : callFull(c) && <span className="pill bad">{t("Complet")}</span>}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
