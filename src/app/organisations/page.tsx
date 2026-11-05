import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { requireUser } from "@/lib/auth";
import { ORG_KIND_LABEL, roleLabel } from "@/lib/orgs";
import { logoSrc } from "@/lib/logos";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes organisations")} — KolBase` };
}

export default async function Page() {
  const { t } = await getT();
  const user = await requireUser();
  const byOrg = new Map<string, { name: string; logo: string | null; kind: keyof typeof ORG_KIND_LABEL; roles: string[] }>();
  for (const m of user.memberships) {
    const e = byOrg.get(m.organizationId) ?? { name: m.organization.name, logo: logoSrc(m.organization), kind: m.organization.kind, roles: [] };
    e.roles.push(t(roleLabel(m.role, m.organization.kind)));
    byOrg.set(m.organizationId, e);
  }
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <h1>{t("Mes organisations")}</h1>
        {byOrg.size === 0 && <p className="muted">{t("Vous n'êtes membre d'aucune organisation. Créez-en une, ou demandez un lien d'invitation à un administrateur.")}</p>}
        {[...byOrg].map(([id, o]) => (
          <Link key={id} href={`/organisations/${id}`} className="card tile">
            <span className="tile-head">
              <Avatar name={o.name} size={40} square src={o.logo} />
              <span><strong>{o.name}</strong><br /><span className="muted">{t(ORG_KIND_LABEL[o.kind])} · {o.roles.join(", ")}</span></span>
            </span>
          </Link>
        ))}
        <Link href="/organisations/nouvelle" className="btn">{t("Créer une organisation")}</Link>
      </main>
    </>
  );
}
