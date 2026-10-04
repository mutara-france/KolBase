import { SiteHeader } from "@/components/SiteHeader";
import { OrgCard } from "@/components/PublicCards";
import { publicOrgs } from "@/lib/public-data";

export const metadata = { title: "Organisations — Kolbase" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const orgs = await publicOrgs();
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Côté organisations</div>
              <h1 className="section-h2">Industriels, sociétés savantes, associations</h1>
              <p className="text-sm mt-1">Les organisations référencées sur Kolbase et leurs appels ouverts.</p>
            </div>
          </div>
          <div className="grid-3">{orgs.map((o) => <OrgCard key={o.id} o={o} />)}</div>
        </section>
      </main>
    </>
  );
}
