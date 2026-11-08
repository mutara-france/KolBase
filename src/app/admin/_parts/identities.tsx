import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/events";
import { removePractitionerPhoto, reviewRpps } from "@/lib/admin-actions";
import { photoPath } from "@/lib/expert-photo";
import { Avatar } from "@/components/Avatar";
import { ConfirmButton } from "@/components/ConfirmButton";
import { country, licenseRule, practicesInFrance, registryLink } from "@/lib/countries";
import { identityQueueWhere } from "@/lib/admin-data";

/** Identités des praticiens : numéros à contrôler (RPPS, identifiant du pays), photos récentes, derniers contrôles. */
export async function IdentityQueue() {
  const [rppsQueue, rppsDone, photos] = await Promise.all([
    db.practitionerProfile.findMany({
      where: identityQueueWhere,
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { updatedAt: "asc" },
    }),
    db.practitionerProfile.findMany({
      where: { rppsCheckedAt: { not: null } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { rppsCheckedAt: "desc" },
      take: 20,
    }),
    // Photos des praticiens, les plus récentes d'abord : contrôle a posteriori (portrait de la personne, rien de choquant).
    db.practitionerProfile.findMany({
      where: { photoUpdatedAt: { not: null } },
      select: { id: true, profession: true, listed: true, photoUpdatedAt: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { photoUpdatedAt: "desc" },
      take: 30,
    }),
  ]);
  return (
    <>
      <p className="muted">
        Contrôlez chaque numéro sur le registre du pays d&apos;exercice (en France, l&apos;<a href="https://annuaire.sante.fr/" target="_blank" rel="noreferrer">Annuaire Santé <ExternalLink size={12} /></a>) :
        le nom, la profession et la situation d&apos;exercice doivent correspondre. Le badge « Identité vérifiée » s&apos;affiche dès la validation.
      </p>
      {rppsQueue.length === 0 && <p className="muted">Aucune identité en attente.</p>}
      {rppsQueue.map((p) => {
        const fr = practicesInFrance(p.country);
        const id = (fr ? p.rpps : p.licenseNumber) ?? "";
        const reg = registryLink(p.country);
        return (
        <section key={p.id} className="card actions spread">
          <span>
            <strong><Link href={`/admin/comptes/${p.user.id}`}>{p.user.firstName} {p.user.lastName}</Link></strong> · {p.profession}{p.city ? ` · ${p.city}` : ""} · {country(p.country).name}{p.listed ? " · expert référencé" : ""}
            <br />
            <span className="muted">
              {fr ? "RPPS" : licenseRule(p.country).label} <span className="mono">{id}</span> · {p.user.email}
              {reg.url && <> · <a href={reg.url} target="_blank" rel="noreferrer">{reg.label} <ExternalLink size={12} /></a></>}
            </span>
          </span>
          <span className="actions wrap">
            <form action={reviewRpps} className="inline wrap">
              <input type="hidden" name="practitionerId" value={p.id} />
              <input type="hidden" name="identifier" value={id} />
              <button className="btn small" name="decision" value="verify">Valider</button>
            </form>
            <form action={reviewRpps} className="inline wrap">
              <input type="hidden" name="practitionerId" value={p.id} />
              <input type="hidden" name="identifier" value={id} />
              <input name="note" placeholder="Motif du refus (obligatoire)" aria-label="Motif du refus" required />
              <button className="btn ghost small" name="decision" value="reject">Refuser</button>
            </form>
          </span>
        </section>
        );
      })}
      {photos.length > 0 && (
        <section className="card stack-sm">
          <h2>Photos des praticiens ({photos.length} plus récentes)</h2>
          <p className="muted text-sm">Chaque photo est recadrée et débarrassée de ses métadonnées à l&apos;envoi. Retirez celle qui n&apos;est pas un portrait de la personne : elle est prévenue par e-mail, avec le motif.</p>
          <ul className="photo-review">
            {photos.map((p) => {
              const name = `${p.user.firstName} ${p.user.lastName}`;
              return (
                <li key={p.id}>
                  <Avatar name={name} size={64} photo={photoPath(p.id, p.photoUpdatedAt!)} />
                  <span className="text-sm">
                    {p.listed ? <Link href={`/experts/${p.id}`}>{name}</Link> : name}
                    <br />
                    <span className="text-xs muted">{p.profession} · {formatDate(p.photoUpdatedAt!)}</span>
                  </span>
                  <form action={removePractitionerPhoto} className="inline wrap">
                    <input type="hidden" name="practitionerId" value={p.id} />
                    <input name="note" placeholder="Motif (facultatif)" aria-label={`Motif du retrait de la photo de ${name}`} maxLength={300} />
                    <ConfirmButton className="btn ghost small" confirm="retirer cette photo">Retirer</ConfirmButton>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {rppsDone.length > 0 && (
        <section className="card">
          <h2>Derniers contrôles</h2>
          <ul className="pub-list">
            {rppsDone.map((p) => (
              <li key={p.id}>
                <strong>{p.user.firstName} {p.user.lastName}</strong>
                <span className="text-xs">
                  {practicesInFrance(p.country) ? `RPPS ${p.rpps}` : `${country(p.country).name} · ${p.licenseNumber}`} · {p.rppsVerified ? "validé" : `refusé${p.rppsCheckNote ? ` : ${p.rppsCheckNote}` : ""}`} le {formatDate(p.rppsCheckedAt!)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
