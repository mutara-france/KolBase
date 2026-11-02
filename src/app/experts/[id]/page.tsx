import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { ExpertProfile } from "@/components/ExpertProfile";
import { getCurrentUser } from "@/lib/auth";
import { SOURCING_ROLES } from "@/lib/projects";
import { kolViewer } from "@/lib/visibility";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { drPrefix } from "@/lib/professions";

/** Titre et description de la fiche (seulement les informations publiques de l'expert). */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await db.practitionerProfile.findFirst({ where: { id, listed: true }, include: { user: { select: { firstName: true, lastName: true } } } });
  if (!p) return { title: "Profil expert — KolBase", robots: { index: false } };
  const name = `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}`;
  const what = [p.specialty || p.profession, p.subspecialty].filter(Boolean).join(" · ");
  return { title: `${name}${what ? ` — ${what}` : ""} — KolBase`, description: (p.bio ?? `${name}, expert référencé sur KolBase.`).slice(0, 160) };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const viewer = kolViewer(user, id);
  const org = user?.memberships.find((m) => SOURCING_ROLES.includes(m.role) && m.organization.kind !== "PRESTATAIRE" && m.organization.verification === "VERIFIED");
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
