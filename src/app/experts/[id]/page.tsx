import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { ExpertProfile } from "@/components/ExpertProfile";
import { getCurrentUser } from "@/lib/auth";
import { PROJECT_ROLES } from "@/lib/projects";
import type { Viewer } from "@/lib/visibility";

export const metadata = { title: "Profil expert — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const viewer: Viewer = user?.practitioner?.id === id ? "proprietaire" : user ? "membre" : "public";
  const org = user?.memberships.find((m) => PROJECT_ROLES.includes(m.role));
  const profile = await ExpertProfile({ id, viewer, userId: user?.id ?? null, solicitHref: org ? `/organisations/${org.organizationId}/dossiers/nouveau?expert=${id}` : null });
  if (!profile) notFound();
  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={user ? "" : "landing"}>
        <div className={user ? "" : "public-section"}>
          <Link href={user ? "/annuaire" : "/experts"} className="back-link"><ArrowLeft size={14} /> {user ? "Annuaire" : "Tous les experts"}</Link>
          {profile}
        </div>
      </main>
    </>
  );
}
