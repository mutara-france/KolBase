import { BookOpen, Building, Building2, KeyRound } from "lucide-react";
import { SectionHead, PageHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { mailEnabled } from "@/lib/mail";
import { EmailVerificationNotice, ListingForm, MyDataCard, NotificationsForm, PasswordForm, ProfileForm } from "@/components/AccountForms";
import { retentionReasons } from "@/lib/account";
import Link from "next/link";
import { ExpertProfileForm } from "@/components/OrgForms";
import { requireUser } from "@/lib/auth";
import { INTERVENTION_TYPES } from "@/lib/orgs";
import { db } from "@/lib/db";
import { KolVisibilityForm, OrcidImportForm, PhotoForm, PublicationForm, StructureForm } from "@/components/ProfileForms";
import { photoPath, userPhotoPath } from "@/lib/expert-photo";
import { drPrefix } from "@/lib/professions";
import { kolVisibility } from "@/lib/visibility";
import { canBeExpert } from "@/lib/professions";
import { practicesInFrance, professionalId } from "@/lib/countries";
import { orcidOAuth } from "@/lib/orcid";
import { wantsEmail } from "@/lib/notifications";
import { removePublication, removeStructure } from "@/lib/profile-actions";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { subscribed } from "@/lib/newsletter";
import { isPlatformAdmin } from "@/lib/platform";
import QRCode from "qrcode";
import { TwoFactorCard } from "@/components/TwoFactorForms";
import { otpauthUri } from "@/lib/totp";
import { adminTwoFactorRequired, requiringOrgs } from "@/lib/two-factor";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mon compte")} — KolBase` };
}

const ORCID_NOTICE = {
  ok: ["ok", "Compte ORCID connecté : votre iD est vérifié. Vous pouvez importer vos publications."],
  erreur: ["error", "La connexion à ORCID n'a pas abouti. Réessayez."],
  pris: ["error", "Cet iD ORCID est déjà associé à un autre praticien. Contactez-nous s'il s'agit du vôtre."],
} as const;

const EMAIL_NOTICE = {
  confirme: ["ok", "Adresse e-mail confirmée. Merci !"],
  "deja-confirme": ["ok", "Votre adresse e-mail est déjà confirmée : ce lien a déjà servi, il n'y a rien d'autre à faire."],
  "autre-compte": ["ok", "Ce lien confirmait l'adresse d'un autre compte KolBase que celui avec lequel vous êtes connecté : cette adresse est confirmée."],
  "lien-invalide": ["error", "Ce lien de confirmation n'est plus valable (déjà utilisé ou expiré). Si votre adresse n'est pas confirmée, demandez un nouveau lien ci-dessous."],
} as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ annuaire?: string; candidater?: string; orcid?: string; email?: string; admin?: string; securite?: string }> }) {
  const { annuaire, candidater, orcid, email, admin, securite } = await searchParams;
  const emailNotice = email && email in EMAIL_NOTICE ? EMAIL_NOTICE[email as keyof typeof EMAIL_NOTICE] : null;
  const orcidNotice = orcid && orcid in ORCID_NOTICE ? ORCID_NOTICE[orcid as keyof typeof ORCID_NOTICE] : null;
  const user = await requireUser();
  const { t, locale } = await getT();
  const p = user.practitioner;
  const expertCapable = !!p && (canBeExpert(p.profession) || p.listed);
  // Double authentification en cours d'activation : QR code du secret (pas encore actif).
  const requiring = requiringOrgs(user);
  const twoFactorSetup = !user.totpEnabledAt && user.totpSecret
    ? { qr: await QRCode.toString(otpauthUri(user.totpSecret, user.email), { type: "svg", margin: 1, width: 180, errorCorrectionLevel: "M" }), secret: user.totpSecret }
    : null;
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
        <PageHead title={t("Mon compte")} desc={<>{t(p ? (p.listed ? "Praticien · expert référencé" : "Praticien · participant") : "Compte organisation")}{user.memberships.length > 0 && ` · ${user.memberships.map((m) => m.organization.name).join(", ")}`}</>} />
        {annuaire && (
          <p className="notice error">{t("L'annuaire est réservé aux membres d'une organisation et aux experts référencés.")}</p>
        )}
        {/* Opportunités ouvertes sans être référencé : la marche à suivre, pas le message de l'annuaire. */}
        {candidater && (
          <p className="notice warn" role="status">
            {p && canBeExpert(p.profession)
              ? t("Référencez-vous pour candidater : les opportunités sont réservées aux experts référencés. C'est l'encart « Référencement » ci-dessous.")
              : t("Les opportunités sont réservées aux praticiens référencés comme experts (chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues).")}
          </p>
        )}
        {orcidNotice && <p className={`notice ${orcidNotice[0]}`}>{t(orcidNotice[1])}</p>}
        {emailNotice && <p className={`notice ${emailNotice[0]}`}>{t(emailNotice[1])}</p>}
        {admin === "confirmer" && !user.emailVerifiedAt && <p className="notice warn">{t("Confirmez votre adresse e-mail pour accéder à l'administration KolBase.")}</p>}
        {!user.emailVerifiedAt && <EmailVerificationNotice email={user.email} practitioner={!!user.practitioner} mailOn={mailEnabled()} />}
        {/* Sommaire : la page est longue, chaque encart a son ancre. */}
        <nav className="account-toc" aria-label={t("Sommaire")}>
          {[
            p && ["#referencement", t("Référencement")],
            ["#photo", t("Photo")],
            p?.listed && ["#profil-expert", t("Profil expert")],
            p && expertCapable && ["#publications", t("Publications")],
            p && expertCapable && ["#structures", t("Structures juridiques")],
            ["#informations", t("Informations personnelles")],
            ["#notifications", t("Notifications")],
            ["#identifiants", t("Mot de passe")],
            ["#securite", t("Sécurité")],
            ["#donnees", t("Mes données")],
            ["#organisations", t("Organisations")],
          ].filter((x): x is [string, string] => !!x).map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        {p && (
          <div id="referencement">
            <ListingForm
              listed={p.listed}
              eligible={canBeExpert(p.profession)}
              idMissing={professionalId(p).value ? null : professionalId(p).short}
              rpps={practicesInFrance(p.country) && canBeExpert(p.profession) ? { value: p.rpps, status: !p.rpps ? "none" : p.rppsVerified ? "verified" : p.rppsCheckedAt ? "rejected" : "pending", note: p.rppsCheckNote } : null}
            />
          </div>
        )}
        {p?.listed && (
          <div className="actions" style={{ marginTop: 0 }}>
            <Link className="btn secondary" href={`/experts/${p.id}`}>{t("Voir ma fiche publique")}</Link>
          </div>
        )}
        {/* Photo de profil : pour tous les comptes (praticien sur son profil, membre d'organisation sur son compte). */}
        {p ? (
          <PhotoForm
            name={`${drPrefix(p.profession)}${user.firstName} ${user.lastName}`}
            src={p.photoUpdatedAt ? photoPath(p.id, p.photoUpdatedAt) : null}
            consent={!!p.photoConsentAt}
            level={kolVisibility(p.visibility).photo}
            mode={p.listed ? "expert" : "praticien"}
          />
        ) : (
          <PhotoForm name={`${user.firstName} ${user.lastName}`} src={user.photoUpdatedAt ? userPhotoPath(user.id, user.photoUpdatedAt) : null} mode="compte" />
        )}
        {p?.listed && (
          <div id="profil-expert"><ExpertProfileForm
            types={INTERVENTION_TYPES}
            p={{ bio: p.bio, hospital: p.hospital, subspecialty: p.subspecialty, orcid: p.orcid, languages: p.languages, interventionTypes: p.interventionTypes, dayRateCents: p.dayRateCents }}
          /></div>
        )}
        {p?.listed && <KolVisibilityForm v={kolVisibility(p.visibility)} />}
        {/* Publications et structures juridiques : pour les professions qui peuvent être expertes. */}
        {p && expertCapable && (
          <section className="card stack" id="publications">
            <SectionHead icon={BookOpen} title={t("Publications ({n})", { n: pubs.length })} />
            <OrcidImportForm
              orcid={p.orcid}
              oauth={!!orcidOAuth()}
              verified={p.orcidVerified}
              syncedAt={p.orcidSyncedAt ? fmtDate(locale, p.orcidSyncedAt, {}) : null}
            />
            {pubs.length > 0 && (
              <ul className="pub-list">
                {pubs.map((x) => (
                  <li key={x.id} className="flex-between">
                    <span><strong>{x.title}</strong><br /><span className="text-xs">{[x.journal, x.year, x.source === "orcid" ? t("importée d'ORCID") : null].filter(Boolean).join(" · ")}</span></span>
                    <form action={removePublication}><input type="hidden" name="id" value={x.id} /><button className="link danger">{t("Retirer")}</button></form>
                  </li>
                ))}
              </ul>
            )}
            <PublicationForm />
          </section>
        )}
        {p && expertCapable && (
          <section className="card stack" id="structures">
            <SectionHead icon={Building2} title={t("Structures juridiques ({n})", { n: structs.length })} />
            <p className="muted">
              {t("Sociétés d'exercice, associations, fonctions déclarées.")}{" "}
              {t("La structure de facturation, reprise par vos conventions et vos notes d'honoraires, se règle avec vos coordonnées de facturation :")}{" "}
              <Link href="/revenus?onglet=facturation#coordonnees">{t("Mes revenus › Notes d'honoraires")}</Link>
            </p>
            {structs.length > 0 && (
              <ul className="pub-list">
                {structs.map((x) => (
                  <li key={x.id} className="flex-between">
                    <span><strong>{x.name}</strong><br /><span className="text-xs">{t(x.legalForm)}{x.siren ? ` · SIREN ${x.siren}` : ""}{x.role ? ` · ${t(x.role)}` : ""}{x.isPayee ? ` · ${t("structure de facturation")}` : ""}</span></span>
                    <form action={removeStructure}><input type="hidden" name="id" value={x.id} /><button className="link danger">{t("Retirer")}</button></form>
                  </li>
                ))}
              </ul>
            )}
            <StructureForm />
          </section>
        )}
        <div id="informations"><ProfileForm
          user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, locale: user.locale }}
          practitioner={
            p
              ? {
                  profession: p.profession, rpps: p.rpps, country: p.country, licenseNumber: p.licenseNumber, city: p.city, postalCode: p.postalCode, specialty: p.specialty, listed: p.listed,
                  rppsStatus: !(p.country === "FR" ? p.rpps : p.licenseNumber) ? "none" : p.rppsVerified ? "verified" : p.rppsCheckedAt ? "rejected" : "pending",
                  rppsNote: p.rppsCheckNote,
                }
              : null
          }
        /></div>
        <div id="notifications"><NotificationsForm email={wantsEmail(user)} newsletter={subscribed(user)} practitioner={!!user.practitioner} mailOn={mailEnabled()} /></div>
        <div id="identifiants"><PasswordForm email={user.email} /></div>
        <section className="card stack-sm" id="securite" aria-labelledby="securite-titre">
          <SectionHead icon={KeyRound} id="securite-titre" title={t("Sécurité : double authentification")} />
          {securite && !user.totpEnabledAt && (
            <p className="notice warn" role="alert">
              {securite === "admin"
                ? t("L'administration de KolBase exige la double authentification : activez-la pour continuer.")
                : t("{org} exige la double authentification de ses membres : activez-la pour accéder à son espace.", { org: requiring.find((o) => o.id === securite)?.name ?? t("Votre organisation") })}
            </p>
          )}
          <p className="muted">{t("Après votre mot de passe, un code à 6 chiffres affiché par une application de votre téléphone vous est demandé : un mot de passe dérobé ne suffit plus pour accéder à votre compte.")}</p>
          <TwoFactorCard
            enabledAt={user.totpEnabledAt ? fmtDate(locale, user.totpEnabledAt, { day: "numeric", month: "long", year: "numeric" }) : null}
            setup={twoFactorSetup}
            recoveryLeft={user.recoveryCodes.length}
            locked={requiring.length > 0 || (isPlatformAdmin(user) && adminTwoFactorRequired())}
          />
        </section>
        <div id="donnees"><MyDataCard keep={await retentionReasons(user.id)} /></div>
        <section className="card" id="organisations">
          <SectionHead icon={Building} title={t("Organisations")} />
          <p className="muted">
            {user.memberships.length > 0
              ? t("Vous êtes membre d'au moins une organisation.")
              : t("Vous représentez un industriel, une société savante, une association ou un organisme de formation ?")}
          </p>
          <div className="actions">
            {user.memberships.length > 0 && <Link className="btn ghost" href="/organisations">{t("Mes organisations")}</Link>}
            <Link className="btn ghost" href="/organisations/nouvelle">{t("Créer une organisation")}</Link>
          </div>
        </section>
      </main>
    </>
  );
}
