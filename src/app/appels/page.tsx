import Link from "next/link";
import { LogIn } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CallCard } from "@/components/PublicCards";
import { publicCalls } from "@/lib/public-data";

export const metadata = { title: "Opportunités — Kolbase" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const calls = await publicCalls();
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Dans les deux sens</div>
              <h1 className="section-h2">Opportunités ouvertes</h1>
              <p className="text-sm mt-1">Appels publiés par les organisations. La candidature est réservée aux experts référencés.</p>
            </div>
          </div>
          {calls.length === 0 && <p className="muted">Aucun appel ouvert pour le moment.</p>}
          <div className="grid-2">
            {calls.map((c) => (
              <CallCard key={c.id} c={c} action={<Link href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`} className="btn secondary"><LogIn size={14} /> Se connecter pour candidater</Link>} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
