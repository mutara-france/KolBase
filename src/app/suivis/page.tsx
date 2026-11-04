import Link from "next/link";
import { Bell, BellRing } from "lucide-react";
import { TodoList } from "@/components/Todo";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { followFeed, seenSince } from "@/lib/follows";
import { toggleFollow } from "@/lib/follow-actions";
import { ORG_KIND_LABEL } from "@/lib/orgs";
import { expertPhotoSrc } from "@/lib/expert-photo";
import { logoSrc } from "@/lib/logos";
import { kolViewer } from "@/lib/visibility";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes suivis")} — KolBase` };
}

export default async function Page() {
  const user = await requireUser();
  const { t, locale } = await getT();
  const since = await seenSince(user.id, user.followsSeenAt);
  const [feed, follows] = await Promise.all([
    followFeed(user.id),
    db.follow.findMany({
      // Un profil retiré de l'annuaire (ou une organisation non validée) disparaît de la liste des suivis.
      where: { userId: user.id, OR: [{ practitioner: { listed: true } }, { organization: { listed: true, verification: "VERIFIED" } }] },
      include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } }, organization: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  // La visite marque les mises à jour comme lues (le badge du menu se remet à zéro).
  await db.user.update({ where: { id: user.id }, data: { followsSeenAt: new Date() } });
  const isNew = (d: Date) => d > since;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <h1>{t("Mes suivis")}</h1>
        <p className="muted">
          {t("Suivez des experts et des organisations depuis leur fiche (bouton « Suivre ») : vous voyez ici leurs nouvelles publications, interventions, appels et événements.")}
        </p>

        <section className="card">
          <h2 className="section-title"><BellRing size={16} /> {t("Mises à jour récentes")}</h2>
          {feed.length === 0 && <p className="muted">{t("Aucune mise à jour pour l'instant.")}</p>}
          {feed.length > 0 && (
            <TodoList
              items={feed.slice(0, 40).map((i) => ({
                href: i.href,
                title: `${i.subject}${isNew(i.date) ? ` · ${t("nouveau")}` : ""}`,
                detail: `${t(i.msg.key, i.msg.vars)} · ${fmtDate(locale, i.date)}`,
                icon: isNew(i.date) ? ("BellRing" as const) : ("Bell" as const),
                tone: isNew(i.date) ? ("electric" as const) : ("ok" as const),
              }))}
            />
          )}
        </section>

        <section className="stack">
          <h2 className="section-title"><Bell size={16} /> {t("Profils suivis ({n})", { n: follows.length })}</h2>
          {follows.length === 0 && (
            <div className="card empty"><Bell size={22} /><p>{t("Vous ne suivez aucun profil. Le bouton « Suivre » se trouve sur chaque fiche d'expert et d'organisation.")}</p></div>
          )}
          <div className="grid-2">
            {follows.map((f) => {
              const p = f.practitioner;
              const o = f.organization;
              const name = p ? `Dr ${p.user.firstName} ${p.user.lastName}` : o?.name ?? "";
              const href = p ? `/experts/${p.id}` : `/structures/${o?.id}`;
              return (
                <div key={f.id} className="card stack-sm">
                  <div className="actions">
                    <Avatar name={name} size={42} ring={!!p} square={!p} photo={p ? expertPhotoSrc(p, kolViewer(user, p.id)) : null} src={o ? logoSrc(o) : null} />
                    <div>
                      <div className="eyebrow-sm">{p ? p.specialty ?? t(p.profession) : o ? t(ORG_KIND_LABEL[o.kind]) : ""}</div>
                      <h3 style={{ margin: 0 }}>{name}</h3>
                    </div>
                  </div>
                  <p className="text-sm">{p ? p.bio : o?.about}</p>
                  <div className="actions">
                    <Link className="btn secondary small" href={href}>{t("Voir la fiche")}</Link>
                    <form action={toggleFollow}>
                      <input type="hidden" name="type" value={p ? "practitioner" : "organization"} />
                      <input type="hidden" name="id" value={p ? p.id : o!.id} />
                      <button className="btn ghost small"><Bell size={13} /> {t("Ne plus suivre")}</button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
