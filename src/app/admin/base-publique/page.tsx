import { requirePlatformAdmin } from "@/lib/platform";
import { db } from "@/lib/db";
import { TableWrap } from "@/components/TableWrap";
import { MarketImportForm } from "@/components/AdminForms";
import { importInterrupted } from "@/lib/market-import";
import { formatDate } from "@/lib/events";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";

export const metadata = { title: "Base publique — Administration KolBase" };
export const dynamic = "force-dynamic";

const STATUS = { en_cours: ["en cours", "wait"], pret: ["prêt", "ok"], echec: ["en échec", "wait"] } as const;
const int = (n: number) => n.toLocaleString("fr-FR");

/**
 * Base publique Transparence Santé de KolBase Intelligence : l'équipe KolBase colle le lien de partage du fichier
 * (Google Drive ou Google Sheets) et lance sa lecture. Les organisations qui ont l'option lisent le dernier import
 * prêt : comparaison au marché, organisations équivalentes, recommandations. Elles n'importent rien elles-mêmes.
 */
export default async function Page() {
  await requirePlatformAdmin();
  const imports = await db.marketImport.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  const current = imports.find((i) => i.status === "pret");
  const running = imports.find((i) => i.status === "en_cours" && !importInterrupted(i));
  return (
    <AdminFrame title="Base publique" desc="Fichier Transparence Santé lu par KolBase Intelligence : il sert à comparer chaque organisation au marché et à fonder ses recommandations." crumbs={[ADMIN_HOME]}>
      {/* Lecture en cours : la page se relit seule toutes les dix secondes. */}
      {running && <meta httpEquiv="refresh" content="10" />}
      <section className="card stack-sm">
        <h2>Mettre à jour la base</h2>
        <p className="muted">Collez le lien de partage du fichier CSV exporté de transparence.sante.gouv.fr (déposé sur Google Drive) ou d&apos;une feuille Google Sheets. Le fichier doit être partagé à « Tous les utilisateurs disposant du lien », en lecture. La nouvelle version remplace l&apos;ancienne quand elle est lue en entier ; en cas d&apos;échec, l&apos;ancienne reste en service.</p>
        <MarketImportForm link={imports[0]?.sourceUrl ?? ""} busy={!!running} />
        <p className="notice">La réutilisation de la base Transparence Santé est encadrée par sa licence et par l&apos;article L.1453-1 du code de la santé publique (finalité de transparence des liens d&apos;intérêts). En l&apos;important, KolBase en devient le réutilisateur : avis juridique à obtenir avant toute ouverture payante.</p>
      </section>
      <section className="card stack-sm">
        <h2>Données en service</h2>
        {!current ? <p className="muted">Aucune base chargée : KolBase Intelligence n&apos;affiche pas encore de comparaison.</p> : (
          <dl className="hero-facts">
            <div><dt>Liens publiés</dt><dd>{int(current.kept)}<small>sur {int(current.rows)} lignes lues</small></dd></div>
            <div><dt>Entreprises</dt><dd>{int(current.companies)}</dd></div>
            <div><dt>Bénéficiaires</dt><dd>{int(current.people)}</dd></div>
            <div><dt>Années</dt><dd>{current.firstYear === current.lastYear ? current.lastYear : `${current.firstYear} – ${current.lastYear}`}<small>mise à jour du {formatDate(current.finishedAt ?? current.createdAt)}</small></dd></div>
          </dl>
        )}
      </section>
      <section className="card stack-sm">
        <h2>Dernières mises à jour</h2>
        {imports.length === 0 ? <p className="muted">Aucune mise à jour pour l&apos;instant.</p> : (
          <TableWrap label="Dernières mises à jour de la base publique">
            <table className="table">
              <thead><tr><th>Lancée le</th><th>État</th><th>Lignes lues</th><th>Liens conservés</th><th>Fichier</th></tr></thead>
              <tbody>
                {imports.map((i) => {
                  const stale = i.status === "en_cours" && i !== running;
                  const [label, tone] = stale ? ["interrompue", "wait"] : STATUS[i.status];
                  return (
                    <tr key={i.id}>
                      <td data-label="Lancée le">{formatDate(i.createdAt)}</td>
                      <td data-label="État"><span className={`pill ${tone}`}>{label}</span>{i === current && <>{" "}<span className="pill">en service</span></>}{i.error && <div className="text-xs warn-text">{i.error}</div>}</td>
                      <td data-label="Lignes lues">{int(i.rows)}</td>
                      <td data-label="Liens conservés">{int(i.kept)}</td>
                      <td data-label="Fichier"><a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs">{i.sourceUrl.slice(0, 60)}{i.sourceUrl.length > 60 ? "…" : ""}</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </AdminFrame>
  );
}
