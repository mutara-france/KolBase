import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatEUR } from "@/lib/events";
import { COLLAB_TYPES, collabType } from "@/lib/projects";

export const metadata = { title: "Opportunités — Kolbase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const user = await requireUser();
  if (!user.practitioner?.listed) redirect("/compte?annuaire=1");
  const { type = "", q = "" } = await searchParams;
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
        <div>
          <h1>Opportunités</h1>
          <p className="muted">Appels ouverts publiés par les organisations. Candidatez à ceux qui correspondent à votre expertise.</p>
        </div>
        <form className="card form search">
          <div className="row">
            <label>Recherche<input name="q" defaultValue={q} placeholder="Spécialité, ville, sujet…" /></label>
            <label>Type
              <select name="type" defaultValue={type}>
                <option value="">Tous</option>
                {COLLAB_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <button className="btn">Filtrer</button>
        </form>
        {calls.length === 0 && <p className="muted">Aucune opportunité ouverte pour ces critères.</p>}
        <div className="grid">
          {calls.map((c) => (
            <Link key={c.id} href={`/opportunites/${c.id}`} className="card tile">
              <span className="tag">{collabType(c.typeId)?.label ?? c.typeId}</span>
              <strong>{c.title}</strong>
              <span className="muted">{c.organization.name}{c.specialty ? ` · ${c.specialty}` : ""}</span>
              {(c.budgetMinCents != null || c.budgetMaxCents != null) && (
                <span className="muted">Budget {[c.budgetMinCents, c.budgetMaxCents].filter((x) => x != null).map((x) => formatEUR(x!)).join(" – ")} HT</span>
              )}
              <span className="muted">{c.deadline ? `Jusqu'au ${formatDate(c.deadline)}` : "Sans date limite"}</span>
              {c.applications.length > 0 && <span className="pill ok">Candidature envoyée</span>}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
