import { SiteHeader } from "@/components/SiteHeader";
import { ListingForm, PasswordForm, ProfileForm } from "@/components/AccountForms";
import Link from "next/link";
import { ExpertProfileForm } from "@/components/OrgForms";
import { requireUser } from "@/lib/auth";
import { INTERVENTION_TYPES } from "@/lib/orgs";
import { db } from "@/lib/db";
import { KolVisibilityForm, OrcidImportForm, PublicationForm, StructureForm } from "@/components/ProfileForms";
import { kolVisibility } from "@/lib/visibility";
import { removePublication, removeStructure } from "@/lib/profile-actions";

export const metadata = { title: "Mon compte — Kolbase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ annuaire?: string }> }) {
  const { annuaire } = await searchParams;
  const user = await requireUser();
  const p = user.practitioner;
  const [pubs, structs] = p
    ? await Promise.all([
        db.publication.findMany({ where: { practitionerId: p.id }, orderBy: [{ year: "desc" }, { createdAt: "desc" }] }),
        db.practitionerStructure.findMany({ where: { practitionerId: p.id } }),
      ])
    : [[], []];
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
          <div className="actions" style={{ marginTop: 0 }}>
            <Link className="btn secondary" href={`/experts/${p.id}`}>Voir ma fiche publique</Link>
          </div>
        )}
        {p?.listed && (
          <ExpertProfileForm
            types={INTERVENTION_TYPES}
            p={{ bio: p.bio, hospital: p.hospital, subspecialty: p.subspecialty, orcid: p.orcid, languages: p.languages, interventionTypes: p.interventionTypes, dayRateCents: p.dayRateCents }}
          />
        )}
        {p?.listed && <KolVisibilityForm v={kolVisibility(p.visibility)} />}
        {p && (
          <section className="card stack">
            <h2>Publications ({pubs.length})</h2>
            <OrcidImportForm orcid={p.orcid} syncedAt={p.orcidSyncedAt ? p.orcidSyncedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null} />
            {pubs.length > 0 && (
              <ul className="pub-list">
                {pubs.map((x) => (
                  <li key={x.id} className="flex-between">
                    <span><strong>{x.title}</strong><br /><span className="text-xs">{[x.journal, x.year, x.source === "orcid" ? "importée d'ORCID" : null].filter(Boolean).join(" · ")}</span></span>
                    <form action={removePublication}><input type="hidden" name="id" value={x.id} /><button className="link danger">Retirer</button></form>
                  </li>
                ))}
              </ul>
            )}
            <PublicationForm />
          </section>
        )}
        {p && (
          <section className="card stack">
            <h2>Structures juridiques ({structs.length})</h2>
            <p className="muted">Sociétés d&apos;exercice, associations, fonctions déclarées. La structure de facturation figure sur vos conventions.</p>
            {structs.length > 0 && (
              <ul className="pub-list">
                {structs.map((x) => (
                  <li key={x.id} className="flex-between">
                    <span><strong>{x.name}</strong><br /><span className="text-xs">{x.legalForm}{x.siren ? ` · SIREN ${x.siren}` : ""}{x.role ? ` · ${x.role}` : ""}{x.isPayee ? " · facturation" : ""}</span></span>
                    <form action={removeStructure}><input type="hidden" name="id" value={x.id} /><button className="link danger">Retirer</button></form>
                  </li>
                ))}
              </ul>
            )}
            <StructureForm />
          </section>
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
