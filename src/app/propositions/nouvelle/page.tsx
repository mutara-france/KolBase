import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ProposalForm } from "@/components/ProposalForms";
import { requireUser } from "@/lib/auth";
import { COLLAB_TYPES, PROPOSAL_MAX_ORGS, PROPOSALS_PER_MONTH } from "@/lib/projects";
import { orgsAwaitingProposal, proposalRecipients, proposalsThisMonth } from "@/lib/proposals";
import { ORG_KIND_LABEL } from "@/lib/org-roles";
import { logoSrc } from "@/lib/logos";
import { storageEnabled } from "@/lib/storage";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Proposer un projet")} — KolBase` };
}

/** Projet proposé par un expert référencé : la fiche du projet et le choix des organisations destinataires. */
export default async function Page({ searchParams }: { searchParams: Promise<{ organisation?: string | string[] }> }) {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p?.listed) redirect("/compte#referencement");
  const { t } = await getT();
  const raw = (await searchParams).organisation;
  const preselected = (Array.isArray(raw) ? raw : raw ? [raw] : []).slice(0, PROPOSAL_MAX_ORGS);
  const [orgs, awaiting, sent] = await Promise.all([proposalRecipients(), orgsAwaitingProposal(p.id), proposalsThisMonth(p.id)]);
  const remaining = Math.max(0, PROPOSALS_PER_MONTH - sent);
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/propositions">{t("Mes propositions")}</Link></p>
        <div>
          <h1>{t("Proposer un projet")}</h1>
          <p className="muted">
            {t("Formation, webinaire, étude, comité, relecture… Décrivez votre projet et choisissez jusqu'à {max} organisations (industriels, sociétés savantes, associations, organismes de formation). Chacune peut l'accepter, ce qui ouvre un dossier avec le circuit habituel (conformité, convention, signature), ou le décliner.", { max: PROPOSAL_MAX_ORGS })}
          </p>
        </div>
        {remaining === 0 ? (
          <p className="notice warn">{t("Vous avez envoyé {n} propositions ces 30 derniers jours, le maximum : attendez les réponses avant d'en envoyer d'autres.", { n: PROPOSALS_PER_MONTH })}</p>
        ) : (
          <>
            <p className="hint">{t(remaining > 1 ? "Encore {n} propositions possibles sur 30 jours." : "Encore {n} proposition possible sur 30 jours.", { n: remaining })}</p>
            <ProposalForm
              orgs={orgs.map((o) => ({
                id: o.id,
                name: o.name,
                kind: t(ORG_KIND_LABEL[o.kind]),
                // Secteur et domaines, sans répéter le type (« Société savante · Société savante ») ni un même mot.
                detail: [...new Map([o.sector, ...o.areas.slice(0, 2)].filter((x): x is string => !!x && x.toLowerCase() !== ORG_KIND_LABEL[o.kind].toLowerCase()).map((x) => [x.toLowerCase(), x])).values()].join(" · "),
                logo: logoSrc(o),
                pending: awaiting.has(o.id),
              }))}
              types={COLLAB_TYPES}
              preselected={preselected}
              defaultFee={p.dayRateCents != null ? String(p.dayRateCents / 100) : ""}
              defaultArea={p.specialty ?? ""}
              upload={storageEnabled()}
              max={PROPOSAL_MAX_ORGS}
            />
          </>
        )}
      </main>
    </>
  );
}
