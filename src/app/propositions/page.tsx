import Link from "next/link";
import { Lightbulb, Plus } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Avatar } from "@/components/Avatar";
import { practitionerSectionTabs } from "@/lib/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType, PROPOSAL_ANSWER_LABEL, proposalAnswer, PROPOSALS_PER_MONTH, STATUS_LABEL } from "@/lib/projects";
import { withdrawProposal } from "@/lib/proposal-actions";
import { proposalsThisMonth } from "@/lib/proposals";
import { logoSrc } from "@/lib/logos";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes propositions")} — KolBase` };
}

const TONE = { attente: "wait", retiree: "done", declinee: "done", acceptee: "ok", abandonnee: "done" } as const;

/** Projets proposés par l'expert : la réponse de chaque organisation destinataire, et le retrait tant qu'elle n'a pas répondu. */
export default async function Page({ searchParams }: { searchParams: Promise<{ envoyee?: string }> }) {
  const user = await requireUser();
  const { t, locale } = await getT();
  const p = user.practitioner;
  const { envoyee } = await searchParams;
  const [proposals, sent] = p
    ? await Promise.all([
        db.expertProposal.findMany({
          where: { practitionerId: p.id },
          include: {
            projects: {
              include: {
                organization: { select: { id: true, name: true, logoUpdatedAt: true } },
                experts: { where: { practitionerId: p.id }, select: { id: true, responseNote: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        proposalsThisMonth(p.id),
      ])
    : [[], 0];
  const just = proposals.find((x) => x.id === envoyee);

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        {p?.listed && <SectionNav tabs={practitionerSectionTabs("sollicitations").map((tab) => ({ ...tab, label: t(tab.label) }))} active="propositions" label={t("Rubrique Sollicitations")} />}
        <div className="flex-between wrap">
          <h1 style={{ margin: 0 }}>{t("Mes propositions")}</h1>
          {p?.listed && sent < PROPOSALS_PER_MONTH && <Link className="btn" href="/propositions/nouvelle"><Plus size={15} /> {t("Proposer un projet")}</Link>}
        </div>
        {!p?.listed && <p className="notice warn">{t("Référencez-vous comme expert dans")} <Link href="/compte">{t("Mon compte")}</Link> {t("pour proposer des projets aux organisations.")}</p>}
        {just && (
          <p className="notice ok" role="status">
            {t(just.projects.length > 1 ? "Proposition envoyée à {n} organisations. Chacune reçoit sa copie et vous répond ici ; vous êtes prévenu par e-mail." : "Proposition envoyée. L'organisation vous répond ici ; vous êtes prévenu par e-mail.", { n: just.projects.length })}
          </p>
        )}
        {p?.listed && proposals.length === 0 && (
          <div className="card empty stack-sm">
            <Lightbulb size={22} />
            <p>{t("Un projet de formation, d'étude ou d'intervention ? Proposez-le à cinq organisations au plus : chacune peut l'accepter et ouvrir un dossier avec vous.")}</p>
          </div>
        )}
        {proposals.map((x) => {
          const type = collabType(x.typeId);
          return (
            <section key={x.id} className="card stack-sm">
              <div className="flex-between wrap">
                <h2 style={{ margin: 0 }}>{x.title}</h2>
                <span className="muted text-sm">{t("Envoyée le {date}", { date: fmtDate(locale, x.createdAt) })}</span>
              </div>
              <p className="muted text-sm" style={{ margin: 0 }}>
                {[type && t(type.label), x.therapeuticArea, x.feeCents != null ? t("{amount} HT", { amount: fmtEur(locale, x.feeCents) }) : null].filter(Boolean).join(" · ")}
              </p>
              <ul className="proposal-recipients">
                {x.projects.map((c) => {
                  const link = c.experts[0];
                  const answer = proposalAnswer(c, link);
                  return (
                    <li key={c.id}>
                      <Avatar name={c.organization.name} size={32} square src={logoSrc(c.organization)} />
                      <span className="grow">
                        <strong>{c.organization.name}</strong>
                        {answer === "acceptee" && <span className="text-xs muted"> · {t(STATUS_LABEL[c.status])}</span>}
                      </span>
                      <span className={`pill ${TONE[answer]}`}>{t(PROPOSAL_ANSWER_LABEL[answer])}</span>
                      {link && <Link className="btn ghost small" href={`/sollicitations/${link.id}`}>{t("Ouvrir")}</Link>}
                      {link && answer === "attente" && (
                        <form action={withdrawProposal}>
                          <input type="hidden" name="linkId" value={link.id} />
                          <ConfirmButton className="link danger" confirm={t("retirer la proposition")} summary={t("{org} est prévenue, le dossier est clos.", { org: c.organization.name })} localized>
                            {t("Retirer")}
                          </ConfirmButton>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </>
  );
}
