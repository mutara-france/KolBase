import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { requireUser } from "@/lib/auth";
import { ORG_KIND_LABEL, ROLE_LABEL } from "@/lib/orgs";

export const metadata = { title: "Mes organisations — Kolbase" };

export default async function Page() {
  const user = await requireUser();
  const byOrg = new Map<string, { name: string; kind: keyof typeof ORG_KIND_LABEL; roles: string[] }>();
  for (const m of user.memberships) {
    const e = byOrg.get(m.organizationId) ?? { name: m.organization.name, kind: m.organization.kind, roles: [] };
    e.roles.push(ROLE_LABEL[m.role]);
    byOrg.set(m.organizationId, e);
  }
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <h1>Mes organisations</h1>
        {byOrg.size === 0 && <p className="muted">Vous n&apos;êtes membre d&apos;aucune organisation. Créez-en une, ou demandez un lien d&apos;invitation à un administrateur.</p>}
        {[...byOrg].map(([id, o]) => (
          <Link key={id} href={`/organisations/${id}`} className="card tile">
            <strong>{o.name}</strong>
            <span className="muted">{ORG_KIND_LABEL[o.kind]} · {o.roles.join(", ")}</span>
          </Link>
        ))}
        <Link href="/organisations/nouvelle" className="btn">Créer une organisation</Link>
      </main>
    </>
  );
}
