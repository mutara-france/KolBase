import { SiteHeader } from "@/components/SiteHeader";
import { ListingForm, PasswordForm, ProfileForm } from "@/components/AccountForms";
import Link from "next/link";
import { ExpertProfileForm } from "@/components/OrgForms";
import { requireUser } from "@/lib/auth";
import { INTERVENTION_TYPES } from "@/lib/orgs";

export const metadata = { title: "Mon compte — Kolbase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ annuaire?: string }> }) {
  const { annuaire } = await searchParams;
  const user = await requireUser();
  const p = user.practitioner;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <div>
          <h1>Mon compte</h1>
          <p className="muted">
            {p ? (p.listed ? "Praticien · expert référencé" : "Praticien · participant") : "Compte organisation"}
            {user.memberships.length > 0 && ` · ${user.memberships.map((m) => m.organization.name).join(", ")}`}
          </p>
        </div>
        {annuaire && (
          <p className="notice error">L&apos;annuaire est réservé aux membres d&apos;une organisation et aux experts référencés.</p>
        )}
        {p && <ListingForm listed={p.listed} />}
        {p?.listed && (
          <ExpertProfileForm
            types={INTERVENTION_TYPES}
            p={{ bio: p.bio, hospital: p.hospital, subspecialty: p.subspecialty, orcid: p.orcid, languages: p.languages, interventionTypes: p.interventionTypes, dayRateCents: p.dayRateCents }}
          />
        )}
        <ProfileForm
          user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, locale: user.locale }}
          practitioner={p ? { profession: p.profession, rpps: p.rpps, city: p.city, specialty: p.specialty, listed: p.listed } : null}
        />
        <PasswordForm email={user.email} />
        <section className="card">
          <h2>Organisations</h2>
          <p className="muted">
            {user.memberships.length > 0
              ? "Vous êtes membre d'au moins une organisation."
              : "Vous représentez un industriel, une société savante, une association ou un organisme de formation ?"}
          </p>
          <div className="actions">
            {user.memberships.length > 0 && <Link className="btn ghost" href="/organisations">Mes organisations</Link>}
            <Link className="btn ghost" href="/organisations/nouvelle">Créer une organisation</Link>
          </div>
        </section>
      </main>
    </>
  );
}
