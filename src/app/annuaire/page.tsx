import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { currentSourcingOrg, orgTabs } from "@/lib/org-overview";
import { Avatar } from "@/components/Avatar";
import { db } from "@/lib/db";
import { requireDirectoryAccess } from "@/lib/orgs";
import type { Prisma } from "@/generated/prisma/client";
import { matches } from "@/lib/search";
import { canSee, kolVisibility } from "@/lib/visibility";
import { expertPhotoSrc } from "@/lib/expert-photo";
import { country, practicesInFrance } from "@/lib/countries";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Annuaire des experts")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; ville?: string }> }) {
  await requireDirectoryAccess();
  const { t, locale } = await getT();
  const { q = "", ville = "" } = await searchParams;
  const and: Prisma.PractitionerProfileWhereInput[] = [{ listed: true }];
  for (const word of q.trim().split(/\s+/).filter(Boolean)) {
    const c = { contains: word, mode: "insensitive" as const };
    and.push({
      OR: [
        { user: { firstName: c } }, { user: { lastName: c } }, { specialty: c }, { subspecialty: c },
        { bio: c }, { hospital: c }, { profession: c }, { interventionTypes: { has: word } },
      ],
    });
  }
  if (ville.trim()) and.push({ city: { contains: ville.trim(), mode: "insensitive" } });
  const candidates = await db.practitionerProfile.findMany({
    where: { AND: and },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { listedAt: "desc" },
    take: 300,
  });
  // La requête ci-dessus cherche aussi dans la ville et l'établissement : on retire ensuite les praticiens
  // qui ne correspondent que par des champs qu'ils ont masqués, et on n'affiche que ce qui est visible.
  const experts = candidates
    .map((e) => {
      const contact = canSee(kolVisibility(e.visibility).contact, "membre");
      return { ...e, city: contact ? e.city : null, hospital: contact ? e.hospital : null };
    })
    .filter((e) =>
      matches(q, e.user.firstName, e.user.lastName, e.specialty, e.subspecialty, e.bio, e.hospital, e.profession, country(e.country).name, ...e.interventionTypes,
        ...(locale === "fr" ? [] : [e.specialty, e.profession, country(e.country).name, ...e.interventionTypes].filter((x): x is string => !!x).map((x) => t(x))))
      && matches(ville, e.city, country(e.country).name),
    )
    .slice(0, 100);

  const orgId = await currentSourcingOrg();
  const sectionTabs = orgId ? await orgTabs("praticiens", orgId) : [];
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="rechercher" label={t("Rubrique Praticiens")} />
        <h1>{t("Annuaire des experts")}</h1>
        <form className="card form search">
          <div className="row">
            <label>{t("Recherche")}<input name="q" defaultValue={q} placeholder={t("Nom, spécialité, type d'intervention…")} /></label>
            <label>{t("Ville")}<input name="ville" defaultValue={ville} /></label>
          </div>
          <button className="btn">{t("Rechercher")}</button>
        </form>
        <p className="muted">{t(experts.length > 1 ? "{n} experts référencés" : "{n} expert référencé", { n: experts.length })}</p>
        <div className="grid">
          {experts.map((e) => (
            <Link key={e.id} href={`/experts/${e.id}`} className="card tile">
              <span className="tile-head">
                <Avatar name={`${e.user.firstName} ${e.user.lastName}`} size={44} photo={expertPhotoSrc(e, "membre")} />
                <span>
                  <strong>Dr {e.user.firstName} {e.user.lastName}</strong>
                  <br />
                  <span className="muted">{[e.specialty ? t(e.specialty) : e.profession ? t(e.profession) : null, e.city, practicesInFrance(e.country) ? null : t(country(e.country).name)].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
              {e.interventionTypes.length > 0 && <span className="tags">{e.interventionTypes.slice(0, 3).map((x) => <span key={x} className="tag">{t(x)}</span>)}</span>}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
