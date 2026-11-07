import { SectionHead, PageHead, EmptyState } from "@/components/UI";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, CheckCircle2, Inbox, Send, Store } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CategoryIcon } from "@/components/SupplierBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { QUOTE_STATUS, supplierCategoryLabel, supplierGroup, type SupplierGroup, rfqTitle } from "@/lib/suppliers";
import { quoteTtc } from "@/lib/quotes";
import { BillingNotice } from "@/components/BillingNotice";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, type Locale, type T } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Demandes de devis")} — KolBase` };
}

const DAY = 864e5;

async function loadInvites(supplierId: string) {
  return db.rfqSupplier.findMany({
    where: { supplierId, rfq: { status: { not: "draft" } } },
    include: {
      rfq: {
        include: {
          organization: { select: { id: true, name: true } },
          event: { select: { title: true, startsAt: true, venue: true, city: true } },
          quotes: { where: { supplierId } },
          messages: { where: { supplierId }, orderBy: { createdAt: "desc" }, take: 1, select: { fromSupplier: true } },
        },
      },
    },
    orderBy: { rfq: { sentAt: "desc" } },
  });
}
type Invite = Awaited<ReturnType<typeof loadInvites>>[number];

/** Demandes de devis reçues par un prestataire, rangées par ce qu'elles attendent de lui. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { onglet } = await searchParams;
  // La vitrine a sa propre page.
  if (onglet === "fiche") redirect(`/organisations/${id}/vitrine`);
  const { org } = await requireMembership(id);
  if (org.kind !== "PRESTATAIRE") redirect(`/organisations/${id}`);

  const invites = await loadInvites(id);
  const now = new Date();
  const group = (i: Invite) => supplierGroup(i.rfq, i.rfq.quotes[0], i.declined);
  const by = (g: SupplierGroup) => invites.filter((i) => group(i) === g);
  const when = (i: Invite) => i.rfq.event?.startsAt ?? i.rfq.sentAt ?? i.rfq.createdAt;
  const won = by("won");
  const todo = by("todo");
  const groups: { key: SupplierGroup; icon: typeof Inbox; title: string; desc: string; tone?: "warn" | "ok" | "neutral"; items: Invite[] }[] = [
    { key: "todo", icon: Inbox, tone: "warn", title: t("À traiter"), desc: t("Des organisations attendent votre devis : répondez, posez une question ou déclinez."), items: todo.sort((a, b) => (a.rfq.deadline?.getTime() ?? Infinity) - (b.rfq.deadline?.getTime() ?? Infinity)) },
    { key: "sent", icon: Send, title: t("Devis envoyés"), desc: t("En attente de la décision de l'organisation ; vous pouvez encore réviser votre devis."), items: by("sent") },
    {
      key: "won", icon: CheckCircle2, tone: "ok", title: t("Prestations retenues"), desc: t("Préparez la prestation avec l'organisation : les échanges restent ouverts."),
      items: [...won].sort((a, b) => {
        const fa = when(a) >= now;
        const fb = when(b) >= now;
        if (fa !== fb) return fa ? -1 : 1;
        return fa ? when(a).getTime() - when(b).getTime() : when(b).getTime() - when(a).getTime();
      }),
    },
  ];
  const closed = by("closed");

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <PageHead title={t("Demandes de devis")} desc={t("Les demandes des organisations : répondez par un devis détaillé, échangez, suivez vos prestations retenues.")}>
          <Link className="btn ghost" href={`/organisations/${id}/vitrine`}><Store size={15} /> {t("Ma vitrine")}</Link>
        </PageHead>
        <BillingNotice orgId={id} motive="reponse" />
        {!org.listed && <p className="notice warn">{t("Votre organisation n'apparaît pas dans l'annuaire des prestataires. Complétez la fiche prestataire pour être consulté.")} <Link href={`/organisations/${id}/vitrine`}>{t("Ma vitrine")}</Link></p>}
        <div className="stats">
          <div className="card stat"><span className="muted">{t("À traiter")}</span><strong>{todo.length}</strong></div>
          <div className="card stat"><span className="muted">{t("Devis retenus")}</span><strong>{won.length}</strong></div>
          <div className="card stat"><span className="muted">{t("Montant retenu")}</span><strong>{fmtEur(locale, won.reduce((s, i) => s + i.rfq.quotes[0].amountCents, 0))}{" "}{t("HT")}</strong></div>
        </div>
        {invites.length === 0 && (
          <div className="card empty">
            <EmptyState icon={Inbox} title={t("Aucune demande reçue.")} action={<Link className="btn secondary small" href={`/organisations/${id}/vitrine`}>{t("Compléter ma vitrine")}</Link>}>
              {t("Les organisations vous adressent leurs demandes de devis depuis votre fiche prestataire.")}
            </EmptyState>
          </div>
        )}
        {groups.filter((g) => g.items.length > 0).map((g) => (
          <section key={g.key} className="card row-list" aria-label={g.title}>
            <SectionHead icon={g.icon} tone={g.tone} title={`${g.title} (${g.items.length})`} desc={g.desc} />
            {g.items.map((i) => <InviteRow key={i.rfqId} i={i} orgId={id} t={t} locale={locale} now={now} />)}
          </section>
        ))}
        {closed.length > 0 && (
          <details className="card row-list fold">
            <summary><SectionHead icon={Archive} tone="neutral" title={`${t("Terminées")} (${closed.length})`} desc={t("Déclinées, non retenues, attribuées à un autre prestataire ou annulées.")} /></summary>
            {closed.map((i) => <InviteRow key={i.rfqId} i={i} orgId={id} t={t} locale={locale} now={now} />)}
          </details>
        )}
      </main>
    </>
  );
}

/** Une demande reçue en une ligne : client, événement, échéance, votre devis. */
function InviteRow({ i, orgId, t, locale, now }: { i: Invite; orgId: string; t: T; locale: Locale; now: Date }) {
  const r = i.rfq;
  const q = r.quotes[0];
  const label =
    r.status === "cancelled" ? { tone: "bad", text: t("Annulée") }
    : q ? { tone: q.status === "retained" ? "ok" : q.status === "rejected" ? "done" : "electric", text: t(QUOTE_STATUS[q.status]) }
    : r.status === "awarded" ? { tone: "done", text: t("Attribuée à un autre prestataire") }
    : i.declined ? { tone: "done", text: t("Déclinée") }
    : { tone: "wait", text: t("Devis attendu") };
  const open = r.status === "sent" && !q && !i.declined;
  const late = open && !!r.deadline && r.deadline < now;
  const soon = open && !!r.deadline && !late && r.deadline.getTime() - now.getTime() < 3 * DAY;
  const unread = !!r.messages[0] && !r.messages[0].fromSupplier;
  return (
    <Link href={`/organisations/${orgId}/devis/${r.id}`} className="row-item rfq-row">
      <CategoryIcon category={r.category} />
      <span className="row-main">
        <strong>{rfqTitle(r)}</strong>
        <span className="muted text-sm">{[r.organization.name, t(supplierCategoryLabel(r.category)), r.event ? fmtDate(locale, r.event.startsAt) : null, r.event?.city ?? r.city, r.headcount ? t("{n} participants", { n: r.headcount }) : null].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="row-status">
        <span className={`pill ${label.tone}`}>{label.text}</span>
        {open && r.deadline && (
          <span className={`text-xs ${late ? "danger-text" : soon ? "warn-text" : "muted"}`}>{late ? t("Réponse attendue le {date} : dépassée", { date: fmtDate(locale, r.deadline) }) : t("Réponse avant le {date}", { date: fmtDate(locale, r.deadline) })}</span>
        )}
        {unread && <span className="pill electric">{t("Nouveau message")}</span>}
      </span>
      <span className="row-figures">
        {q ? (
          <>
            <strong>{t("{amount} HT", { amount: fmtEur(locale, q.amountCents) })}</strong>
            <span className="text-xs muted">{t("{amount} TTC", { amount: fmtEur(locale, quoteTtc(q)) })}{q.revision > 1 ? ` · ${t("version {revision}", { revision: q.revision })}` : ""}</span>
          </>
        ) : (
          <span className="text-xs muted">{r.sentAt ? t("Reçue le {date}", { date: fmtDate(locale, r.sentAt) }) : "—"}</span>
        )}
      </span>
    </Link>
  );
}
