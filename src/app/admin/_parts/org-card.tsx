import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ConfirmButton } from "@/components/ConfirmButton";
import { logoSrc } from "@/lib/logos";
import { orgKindDisplay, VERIFICATION_LABEL } from "@/lib/org-roles";
import { formatDate } from "@/lib/events";
import { normalize } from "@/lib/search";
import { recheckSiren, reviewOrganization } from "@/lib/admin-actions";
import type { Organization } from "@/generated/prisma/client";

export const ORG_TONE = { PENDING: "wait", VERIFIED: "ok", REJECTED: "bad", SUSPENDED: "bad" } as const;
/** Messageries grand public : un administrateur d'entreprise s'inscrit d'ordinaire avec l'adresse de la société. */
export const PERSONAL_MAIL = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|gmx|laposte|orange|wanadoo|free|sfr|neuf|bbox|protonmail|proton)\./i;

type Admin = { user: { email: string; firstName: string; lastName: string } };

/** Carte de contrôle d'une organisation : SIREN, répertoire, administrateurs, page publique, et la décision à prendre. */
export function OrgCard({ o, admins, twins, link = true }: { o: Organization; admins: Admin[]; twins: Pick<Organization, "name" | "verification">[]; link?: boolean }) {
  const mismatch = o.legalName && !normalize(o.legalName).includes(normalize(o.name)) && !normalize(o.name).includes(normalize(o.legalName));
  return (
    <section className="card stack-sm">
      <div className="actions spread">
        <span className="actions" style={{ alignItems: "center" }}>
          <Avatar name={o.name} size={44} square src={logoSrc(o)} />
          <span>
            <strong>{link ? <Link href={`/admin/organisations/${o.id}`}>{o.name}</Link> : o.name}</strong> <span className={`pill ${ORG_TONE[o.verification]}`}>{VERIFICATION_LABEL[o.verification]}</span>
            <br />
            <span className="muted">{orgKindDisplay(o)} · créée le {formatDate(o.createdAt)}{o.headquarters ? ` · ${o.headquarters}` : ""}</span>
          </span>
        </span>
      </div>
      <dl className="facts">
        <dt>SIREN</dt>
        <dd>
          {o.siren ? (
            <>
              {o.siren}{" "}
              <a href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${o.siren}`} target="_blank" rel="noreferrer">
                Annuaire des entreprises <ExternalLink size={12} />
              </a>
            </>
          ) : o.rna ? (
            <>
              <span className="muted">non renseigné · RNA</span> {o.rna}{" "}
              <a href={`https://www.journal-officiel.gouv.fr/pages/associations-recherche/?q=${o.rna}`} target="_blank" rel="noreferrer">
                Journal officiel (associations) <ExternalLink size={12} />
              </a>
            </>
          ) : (
            <span className="muted">non renseigné</span>
          )}
        </dd>
        <dt>Répertoire</dt>
        <dd>
          {!o.siren ? "—" : !o.sirenCheckedAt ? "non contrôlé (répertoire indisponible)" : o.legalName ? `${o.legalName}${o.sirenActive === false ? " — FERMÉE" : o.sirenActive ? " — active" : ""}` : "SIREN introuvable"}
          {mismatch && <span className="pill wait" style={{ marginLeft: 8 }}>Nom différent de la raison sociale</span>}
        </dd>
        {twins.length > 0 && (
          <>
            <dt>Même SIREN</dt>
            <dd><span className="pill bad">Doublon possible</span> {twins.map((t) => `${t.name} (${VERIFICATION_LABEL[t.verification].toLowerCase()})`).join(", ")}</dd>
          </>
        )}
        <dt>Administrateurs</dt>
        <dd>
          {admins.map((m) => `${m.user.firstName} ${m.user.lastName} <${m.user.email}>`).join(", ") || "—"}
          {admins.some((m) => PERSONAL_MAIL.test(m.user.email)) && <span className="pill wait" style={{ marginLeft: 8 }}>Adresse personnelle</span>}
        </dd>
        {o.contactEmail && (<><dt>Contact</dt><dd>{o.contactEmail}</dd></>)}
        <dt>Page publique</dt>
        <dd>{o.listed && o.verification === "VERIFIED" ? "oui" : "non"}{o.listed && o.verification === "SUSPENDED" ? " (masquée pendant la suspension)" : o.listed && o.verification !== "VERIFIED" ? " (activée à la validation)" : ""}</dd>
        {o.verificationNote && (<><dt>{o.verification === "SUSPENDED" ? "Motif de la suspension" : "Note"}</dt><dd>{o.verificationNote}</dd></>)}
      </dl>
      <div className="actions wrap">
        {o.verification === "SUSPENDED" && (
          <form action={reviewOrganization} className="inline wrap">
            <input type="hidden" name="orgId" value={o.id} />
            <button className="btn small" name="decision" value="reactivate">Réactiver</button>
            <span className="hint">Page publique, événements et opportunités réapparaissent tels quels ; la facturation de l&apos;abonnement reprend (sauf gratuité en cours) ; les administrateurs sont prévenus.</span>
          </form>
        )}
        {o.verification !== "VERIFIED" && (
          <>
            {o.verification !== "SUSPENDED" && (
              <form action={reviewOrganization} className="inline wrap">
                <input type="hidden" name="orgId" value={o.id} />
                <input name="note" placeholder="Note (facultatif, envoyée à l'organisation)" aria-label="Note de validation (facultatif, envoyée telle quelle à l'organisation)" />
                <button className="btn small" name="decision" value="verify">Valider</button>
                <span className="hint">La note figure telle quelle dans l&apos;e-mail de validation envoyé aux administrateurs de l&apos;organisation.</span>
              </form>
            )}
            {/* Suspendue : pas de refus (il fermerait ses appels) ; la réactiver ou la laisser suspendue. */}
            {o.verification !== "REJECTED" && o.verification !== "SUSPENDED" && (
              <form action={reviewOrganization} className="inline wrap">
                <input type="hidden" name="orgId" value={o.id} />
                <input name="note" placeholder="Motif du refus (obligatoire)" aria-label="Motif du refus" required style={{ minWidth: 260 }} />
                <button className="btn ghost small" name="decision" value="reject">Refuser</button>
              </form>
            )}
          </>
        )}
        {o.verification === "VERIFIED" && (
          <form action={reviewOrganization} className="inline wrap">
            <input type="hidden" name="orgId" value={o.id} />
            <input name="note" placeholder="Motif de la suspension (obligatoire)" aria-label="Motif de la suspension" required />
            <ConfirmButton className="btn ghost small" name="decision" value="suspend" confirm={`suspendre ${o.name}`} summary={<>Page publique, événements et opportunités masqués, aucune nouvelle action ; rien n&apos;est supprimé et « Réactiver » rétablit tout. La facturation de l&apos;abonnement est mise en pause pendant la suspension. Les administrateurs sont prévenus par e-mail, avec le motif.</>}>
              Suspendre
            </ConfirmButton>
          </form>
        )}
        {o.siren && (
          <form action={recheckSiren}>
            <input type="hidden" name="orgId" value={o.id} />
            <button className="link">Relancer le contrôle du SIREN</button>
          </form>
        )}
      </div>
    </section>
  );
}
