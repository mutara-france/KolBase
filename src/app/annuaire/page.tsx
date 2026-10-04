import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { db } from "@/lib/db";
import { requireDirectoryAccess } from "@/lib/orgs";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Annuaire des experts — Kolbase" };

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
  const experts = await db.practitionerProfile.findMany({
    where: { AND: and },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { listedAt: "desc" },
    take: 100,
  });

  return (
    <>
      <SiteHeader />
      <main className="stack">
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
            <Link key={e.id} href={`/annuaire/${e.id}`} className="card tile">
              <span className="tile-head">
                <Avatar name={`${e.user.firstName} ${e.user.lastName}`} size={44} />
                <span>
                  <strong>Dr {e.user.firstName} {e.user.lastName}</strong>
                  <br />
                  <span className="muted">{[e.specialty || e.profession, e.city].filter(Boolean).join(" · ")}</span>
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
