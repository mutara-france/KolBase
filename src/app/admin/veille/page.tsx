import { requirePlatformAdmin } from "@/lib/platform";
import { db } from "@/lib/db";
import { TableWrap } from "@/components/TableWrap";
import { ConfirmButton } from "@/components/ConfirmButton";
import { WatchSourceForm } from "@/components/AdminForms";
import { updateWatchSource } from "@/lib/watch-actions";
import { formatDate } from "@/lib/events";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";

export const metadata = { title: "Veille — Administration KolBase" };
export const dynamic = "force-dynamic";

/**
 * Sources de veille de KolBase Intelligence : flux RSS ou Atom des sites spécialisés, revues et chaînes vidéo, communs
 * à toutes les organisations qui ont l'option. Chacune n'y voit que les publications citant ses concurrents suivis
 * ou elle-même.
 */
export default async function Page() {
  await requirePlatformAdmin();
  const sources = await db.watchSource.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } });
  return (
    <AdminFrame title="Veille" desc="Sources relevées toutes les six heures pour KolBase Intelligence : titre, lien, date et court extrait de chaque publication, conservés treize mois." crumbs={[ADMIN_HOME]}>
      <section className="card stack-sm">
        <h2>Ajouter une source</h2>
        <p className="muted">Adresse https du flux RSS ou Atom d&apos;un site public (presse dentaire, société savante, blog d&apos;un industriel, chaîne YouTube : youtube.com/feeds/videos.xml?channel_id=…). LinkedIn, Instagram, Facebook et X ne publient pas de flux et interdisent la collecte automatisée : leurs publications s&apos;ajoutent à la main, par chaque organisation, depuis sa page Veille.</p>
        <WatchSourceForm />
      </section>
      <section className="card stack-sm">
        <h2>Sources</h2>
        {sources.length === 0 ? <p className="muted">Aucune source pour l&apos;instant : la veille des organisations reste vide.</p> : (
          <TableWrap label="Sources de veille">
            <table className="table">
              <thead><tr><th>Source</th><th>Dernier relevé</th><th>Publications</th><th></th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Source">{s.name}{!s.active && <>{" "}<span className="pill wait">en pause</span></>}<div className="text-xs muted">{s.url}</div></td>
                    <td data-label="Dernier relevé">{s.fetchedAt ? formatDate(s.fetchedAt) : "à venir"}{s.error && <div className="text-xs warn-text">en échec : {s.error}</div>}</td>
                    <td data-label="Publications">{s._count.items}</td>
                    <td>
                      <form action={updateWatchSource} className="inline wrap">
                        <input type="hidden" name="sourceId" value={s.id} />
                        <button className="link" name="op" value={s.active ? "pause" : "resume"}>{s.active ? "mettre en pause" : "relancer"}</button>
                        <ConfirmButton className="link" name="op" value="delete" confirm="supprimer la source" summary={<>{s.name} et ses {s._count.items} publications disparaissent de la veille de toutes les organisations.</>}>supprimer</ConfirmButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </AdminFrame>
  );
}
