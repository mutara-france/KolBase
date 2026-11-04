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

export const metadata = { title: "Annuaire des experts — KolBase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; ville?: string }> }) {
  await requireDirectoryAccess();
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
      matches(q, e.user.firstName, e.user.lastName, e.specialty, e.subspecialty, e.bio, e.hospital, e.profession, country(e.country).name, ...e.interventionTypes)
      && matches(ville, e.city, country(e.country).name),
    )
    .slice(0, 100);

  const orgId = await currentSourcingOrg();
  const sectionTabs = orgId ? await orgTabs("praticiens", orgId) : [];
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="rechercher" label="Rubrique Praticiens" />
        <h1>Annuaire des experts</h1>
        <form className="card form search">
          <div className="row">
            <label>Recherche<input name="q" defaultValue={q} placeholder="Nom, spécialité, type d'intervention…" /></label>
            <label>Ville<input name="ville" defaultValue={ville} /></label>
          </div>
          <button className="btn">Rechercher</button>
        </form>
        <p className="muted">{experts.length} expert{experts.length > 1 ? "s" : ""} référencé{experts.length > 1 ? "s" : ""}</p>
        <div className="grid">
          {experts.map((e) => (
            <Link key={e.id} href={`/experts/${e.id}`} className="card tile">
              <span className="tile-head">
                <Avatar name={`${e.user.firstName} ${e.user.lastName}`} size={44} photo={expertPhotoSrc(e, "membre")} />
                <span>
                  <strong>Dr {e.user.firstName} {e.user.lastName}</strong>
                  <br />
                  <span className="muted">{[e.specialty || e.profession, e.city, practicesInFrance(e.country) ? null : country(e.country).name].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
              {e.interventionTypes.length > 0 && <span className="tags">{e.interventionTypes.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</span>}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
