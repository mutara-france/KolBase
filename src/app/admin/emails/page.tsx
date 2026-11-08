import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { EMAIL_LOG_DAYS, EMAIL_STATUS as STATUS } from "@/lib/email-log";
import { TableWrap } from "@/components/TableWrap";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";

export const metadata = { title: "E-mails — Administration KolBase" };
export const dynamic = "force-dynamic";

const time = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Historique des e-mails envoyés (destinataire, objet, statut, sans le contenu), pour l'assistance : 90 jours. */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string }> }) {
  await requirePlatformAdmin();
  const { q = "", statut = "" } = await searchParams;
  const query = q.trim().toLowerCase().slice(0, 200);
  const list = await db.emailLog.findMany({
    where: { ...(query ? { to: { contains: query } } : {}), ...(statut && statut in STATUS ? { status: statut } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <AdminFrame title="E-mails" desc={`Envois des ${EMAIL_LOG_DAYS} derniers jours : destinataire, objet, statut. Le contenu n'est jamais conservé (il peut porter un lien de connexion).`} crumbs={[ADMIN_HOME]}>
      <form className="inline-form" method="get">
        <label>Destinataire<input name="q" defaultValue={q} placeholder="adresse ou partie d'adresse" /></label>
        <label>Statut
          <select name="statut" defaultValue={statut}>
            <option value="">Tous</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <button className="btn small">Filtrer</button>
      </form>
      {list.length === 0 ? <p className="muted">Aucun envoi.</p> : (
        <TableWrap label="E-mails envoyés">
          <table className="table">
            <thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Statut</th></tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td data-label="Date" className="nowrap">{time(m.createdAt)}</td>
                  <td data-label="Destinataire">{m.to}</td>
                  <td data-label="Objet">{m.subject}</td>
                  <td data-label="Statut"><span className={`pill ${STATUS[m.status]?.tone ?? ""}`}>{STATUS[m.status]?.label ?? m.status}</span>{m.error && <div className="text-xs muted">{m.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </AdminFrame>
  );
}
