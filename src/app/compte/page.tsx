import { SiteHeader } from "@/components/SiteHeader";
import { EmailVerificationNotice, ListingForm, MyDataCard, NotificationsForm, PasswordForm, ProfileForm } from "@/components/AccountForms";
import { retentionReasons } from "@/lib/account";
import Link from "next/link";
import { ExpertProfileForm } from "@/components/OrgForms";
import { requireUser } from "@/lib/auth";
import { INTERVENTION_TYPES } from "@/lib/orgs";
import { db } from "@/lib/db";
import { KolVisibilityForm, OrcidImportForm, PublicationForm, StructureForm } from "@/components/ProfileForms";
import { kolVisibility } from "@/lib/visibility";
import { canBeExpert } from "@/lib/professions";
import { orcidOAuth } from "@/lib/orcid";
import { wantsEmail } from "@/lib/notifications";
import { removePublication, removeStructure } from "@/lib/profile-actions";

export const metadata = { title: "Mon compte — KolBase" };

const ORCID_NOTICE = {
  ok: ["ok", "Compte ORCID connecté : votre iD est vérifié. Vous pouvez importer vos publications."],
  erreur: ["error", "La connexion à ORCID n'a pas abouti. Réessayez."],
  pris: ["error", "Cet iD ORCID est déjà associé à un autre praticien. Contactez-nous s'il s'agit du vôtre."],
} as const;

const EMAIL_NOTICE = {
  confirme: ["ok", "Adresse e-mail confirmée. Merci !"],
  "lien-invalide": ["error", "Ce lien de confirmation n'est plus valable. Demandez-en un nouveau ci-dessous."],
} as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ annuaire?: string; orcid?: string; email?: string; admin?: string }> }) {
  const { annuaire, orcid, email, admin } = await searchParams;
  const emailNotice = email && email in EMAIL_NOTICE ? EMAIL_NOTICE[email as keyof typeof EMAIL_NOTICE] : null;
  const orcidNotice = orcid && orcid in ORCID_NOTICE ? ORCID_NOTICE[orcid as keyof typeof ORCID_NOTICE] : null;
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
        {orcidNotice && <p className={`notice ${orcidNotice[0]}`}>{orcidNotice[1]}</p>}
        {emailNotice && <p className={`notice ${emailNotice[0]}`}>{emailNotice[1]}</p>}
        {admin === "confirmer" && !user.emailVerifiedAt && <p className="notice warn">Confirmez votre adresse e-mail pour accéder à l&apos;administration KolBase.</p>}
        {!user.emailVerifiedAt && <EmailVerificationNotice email={user.email} />}
        {p && <ListingForm listed={p.listed} eligible={canBeExpert(p.profession)} hasRpps={!!p.rpps} />}
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
            <OrcidImportForm
              orcid={p.orcid}
              oauth={!!orcidOAuth()}
              verified={p.orcidVerified}
              syncedAt={p.orcidSyncedAt ? p.orcidSyncedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null}
            />
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
          practitioner={
            p
              ? {
                  profession: p.profession, rpps: p.rpps, country: p.country, licenseNumber: p.licenseNumber, city: p.city, specialty: p.specialty, listed: p.listed,
                  rppsStatus: !(p.country === "FR" ? p.rpps : p.licenseNumber) ? "none" : p.rppsVerified ? "verified" : p.rppsCheckedAt ? "rejected" : "pending",
                  rppsNote: p.rppsCheckNote,
                }
              : null
          }
        />
        <NotificationsForm email={wantsEmail(user)} />
        <PasswordForm email={user.email} />
        <MyDataCard keep={await retentionReasons(user.id)} />
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
