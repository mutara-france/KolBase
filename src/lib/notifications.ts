import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { sendMail, type Mail } from "@/lib/mail";
import { platformAdminEmails } from "@/lib/platform";
import { drPrefix } from "@/lib/professions";
import { COMPLIANCE_ROLES, EVENT_ORGANIZER_ROLES, FORMAT_LABEL, formatEUR, type EventChange } from "@/lib/events";
import { de } from "@/lib/elision";
import { withVat } from "@/lib/quotes";
import { fmtEur, isLocale, makeT, type Locale, type T } from "@/lib/i18n";
import { collabType, PROJECT_ROLES, SOURCING_ROLES, STATUS_LABEL } from "@/lib/projects";
import { orderStats } from "@/lib/services";
import { conversion, reportParts } from "@/lib/service-report";
import type { OrgRole } from "@/generated/prisma/client";

/**
 * Notifications par e-mail des étapes qui attendent une action de quelqu'un.
 * Chaque fonction s'exécute après la réponse (next/server `after`) : une erreur d'envoi ne bloque jamais l'action.
 * Les e-mails de service (mot de passe, confirmation d'adresse, invitation) partent toujours ; les autres
 * respectent la préférence « notifications par e-mail » du compte.
 */
type Recipient = { id: string; email: string; notifyPrefs: unknown; locale?: string };
/** Contenu d'un e-mail, rédigé dans la langue du destinataire (t traduit, le français sert de clé). */
type Compose = (t: T, locale: Locale) => Omit<Mail, "to" | "locale">;

export const wantsEmail = (u: { notifyPrefs: unknown }) =>
  !(u.notifyPrefs && typeof u.notifyPrefs === "object" && (u.notifyPrefs as Record<string, unknown>).email === false);

function later(fn: () => Promise<void>) {
  after(async () => {
    try {
      await fn();
    } catch (e) {
      console.error("[notification en échec]", e);
    }
  });
}

async function send(recipients: Recipient[], mail: Omit<Mail, "to"> | Compose, exceptUserId?: string | null) {
  const seen = new Set<string>();
  for (const u of recipients) {
    if (u.id === exceptUserId || seen.has(u.id) || !wantsEmail(u)) continue;
    seen.add(u.id);
    const locale: Locale = isLocale(u.locale) ? u.locale : "fr";
    await sendMail({ ...(typeof mail === "function" ? mail(makeT(locale), locale) : mail), to: u.email, locale });
  }
}

const userSelect = { id: true, email: true, notifyPrefs: true, locale: true } as const;

/** Membres d'une organisation ayant l'un des rôles. */
async function members(orgId: string, roles: OrgRole[]) {
  const ms = await db.membership.findMany({ where: { organizationId: orgId, role: { in: roles } }, include: { user: { select: userSelect } } });
  return ms.map((m) => m.user);
}

/** Interlocuteur d'un dossier côté organisation : son créateur s'il est toujours membre, sinon l'équipe projets. */
async function projectTeam(project: { organizationId: string; createdById: string | null }) {
  const team = await members(project.organizationId, PROJECT_ROLES);
  const creator = team.find((u) => u.id === project.createdById);
  return creator ? [creator] : team;
}

/** Unité de prestation du type de collaboration (« journée », « séances »…), au pluriel au-delà de 1. */
const unitLabel = (t: T, typeId: string, n: number) => {
  const unit = collabType(typeId)?.unit ?? "unité";
  return n > 1 ? t(`${unit}s`) : t(unit);
};

const expertName = (p: { profession: string; user: { firstName: string; lastName: string } }) => `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}`;

const linkInclude = {
  project: { include: { organization: { select: { name: true } } } },
  practitioner: { include: { user: { select: { ...userSelect, firstName: true, lastName: true } } } },
} as const;

// ─── Praticiens ────────────────────────────────────────────────────────────

/**
 * Nouvelle sollicitation (dossier ouvert par une organisation) ou honoraires proposés après une candidature retenue.
 * `linkIds` : seulement ces experts (expert ajouté à un dossier existant).
 */
export function notifySolicitations(projectId: string, kind: "sollicitation" | "honoraires" = "sollicitation", linkIds?: string[]) {
  later(async () => {
    const links = await db.projectExpert.findMany({ where: { projectId, status: "ATT_EXPERTS", ...(linkIds ? { id: { in: linkIds } } : {}) }, include: linkInclude });
    for (const l of links) {
      const org = l.project.organization.name;
      const title = l.project.title;
      await send([l.practitioner.user], (t, locale) => {
        const fee = l.feeCents != null ? ` ${t("Honoraires proposés : {montant} HT.", { montant: fmtEur(locale, l.feeCents) })}` : "";
        return {
          subject: kind === "honoraires" ? t("Candidature retenue : {org} vous propose des honoraires", { org }) : t("Nouvelle sollicitation de {org}", { org }),
          text:
            kind === "honoraires"
              ? `${t("Bonjour,")}\n\n${t("{org} a retenu votre candidature « {titre} ».", { org, titre: title })}${fee}\n\n${t("Acceptez ou déclinez la proposition sur KolBase : le dossier n'avance qu'après votre réponse.")}`
              : `${t("Bonjour,")}\n\n${t("{org} vous sollicite pour « {titre} ».", { org, titre: title })}${fee}\n\n${t("Vous pouvez donner votre accord de principe, décliner ou poser vos questions sur KolBase.")}`,
          cta: { label: t("Répondre"), href: `/sollicitations/${l.id}` },
        };
      });
    }
  });
}

/** Conditions modifiées par l'organisation (unités, honoraires) : la proposition est renvoyée à l'expert. */
export function notifyNewProposal(linkId: string) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l || l.status !== "ATT_EXPERTS") return;
    const org = l.project.organization.name;
    await send([l.practitioner.user], (t, locale) => ({
      subject: t("Nouvelle proposition de {org}", { org }),
      text: [
        t("Bonjour,"),
        t("{org} a modifié sa proposition pour « {titre} ».", { org, titre: l.project.title }),
        [l.days != null ? t("Prestation : {n} {unit}.", { n: l.days.toLocaleString(locale === "en" ? "en-GB" : "fr-FR"), unit: unitLabel(t, l.project.typeId, l.days) }) : null, l.feeCents != null ? t("Honoraires proposés : {montant} HT.", { montant: fmtEur(locale, l.feeCents) }) : null].filter(Boolean).join(" "),
        t("Votre réponse précédente ne vaut plus pour ces nouvelles conditions : acceptez ou déclinez la proposition sur KolBase."),
      ].filter(Boolean).join("\n\n"),
      cta: { label: t("Répondre"), href: `/sollicitations/${l.id}` },
    }));
  });
}

/** Message dans le fil organisation ↔ expert : prévient l'autre partie. */
export function notifyMessage(linkId: string, authorId: string) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l) return;
    if (l.practitioner.userId === authorId) {
      await send(await projectTeam(l.project), {
        subject: `Nouveau message de ${expertName(l.practitioner)}`,
        text: `Bonjour,\n\n${expertName(l.practitioner)} vous a écrit à propos du dossier « ${l.project.title} ».`,
        cta: { label: "Lire le message", href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` },
      }, authorId);
    } else {
      const org = l.project.organization.name;
      await send([l.practitioner.user], (t) => ({
        subject: t("Nouveau message de {org}", { org }),
        text: `${t("Bonjour,")}\n\n${t("{org} vous a écrit à propos de « {titre} ».", { org, titre: l.project.title })}`,
        cta: { label: t("Lire le message"), href: `/sollicitations/${l.id}` },
      }), authorId);
    }
  });
}

/** Candidature (opportunité ou intervention) non retenue. */
export function notifyNotRetained(userId: string, title: string, orgName: string) {
  later(async () => {
    const u = await db.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!u) return;
    await send([u], (t) => ({
      subject: t("Candidature non retenue : {titre}", { titre: title }),
      text: `${t("Bonjour,")}\n\n${t("{org} n'a pas retenu votre candidature « {titre} ». Merci de votre intérêt ; d'autres opportunités vous attendent sur KolBase.", { org: orgName, titre: title })}`,
      cta: { label: t("Voir les opportunités"), href: "/opportunites" },
    }));
  });
}

// ─── Organisations ─────────────────────────────────────────────────────────

/** Réponse d'un expert à une sollicitation. */
export function notifyExpertAnswer(linkId: string, accepted: boolean) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l) return;
    await send(await projectTeam(l.project), {
      subject: `${expertName(l.practitioner)} ${accepted ? "a donné son accord de principe" : "a décliné"} — ${l.project.title}`,
      text: (accepted
        ? `Bonjour,\n\n${expertName(l.practitioner)} a donné son accord de principe pour « ${l.project.title} ». Vous pouvez soumettre le dossier à la conformité.`
        : `Bonjour,\n\n${expertName(l.practitioner)} a décliné « ${l.project.title} ».${l.responseNote ? `\n\nSon message : ${l.responseNote}` : ""}`)
        + (l.desiredFeeCents != null ? `\n\nHonoraires souhaités : ${fmtEur("fr", l.desiredFeeCents)} HT (proposés : ${l.feeCents != null ? `${fmtEur("fr", l.feeCents)} HT` : "non indiqués"}). Vous pouvez modifier la proposition depuis le dossier.` : ""),
      cta: { label: "Ouvrir le dossier", href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` },
    });
  });
}

/** Proposition spontanée d'un expert. */
export function notifyProposal(projectId: string) {
  later(async () => {
    const p = await db.project.findUnique({ where: { id: projectId }, include: { experts: { include: { practitioner: linkInclude.practitioner } } } });
    const e = p?.experts[0];
    if (!p || !e) return;
    await send(await members(p.organizationId, SOURCING_ROLES), {
      subject: `Proposition de collaboration de ${expertName(e.practitioner)}`,
      text: `Bonjour,\n\n${expertName(e.practitioner)} propose à votre organisation : « ${p.title} ». Acceptez la proposition pour ouvrir le circuit, ou déclinez-la.`,
      cta: { label: "Voir la proposition", href: `/organisations/${p.organizationId}/dossiers/${p.id}` },
    });
  });
}

/** Nouvelle candidature à un appel à candidatures (avec ou sans événement). */
export function notifyApplication(callId: string, practitionerId: string) {
  later(async () => {
    const [call, prac] = await Promise.all([
      db.openCall.findUnique({ where: { id: callId } }),
      db.practitionerProfile.findUnique({ where: { id: practitionerId }, include: { user: { select: { firstName: true, lastName: true } } } }),
    ]);
    if (!call || !prac) return;
    const team = await members(call.organizationId, SOURCING_ROLES);
    const creator = team.find((u) => u.id === call.createdById);
    await send(creator ? [creator] : team, {
      subject: `Nouvelle candidature : ${call.title}`,
      text: `Bonjour,\n\n${expertName(prac)} a candidaté à votre appel « ${call.title} ».`,
      cta: { label: "Voir la candidature", href: `/organisations/${call.organizationId}/opportunites/${call.id}` },
    });
  });
}

/** Honoraires payés : l'expert est prévenu (ses revenus sont à jour dans KolBase). */
export function notifyFeePaid(linkId: string) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l?.paidCents) return;
    await send([l.practitioner.user], (t, locale) => ({
      subject: t("Honoraires payés par {org}", { org: l.project.organization.name }),
      text: t("Bonjour,\n\n{org} indique avoir payé vos honoraires pour « {title} » : {amount} HT.", { org: l.project.organization.name, title: l.project.title, amount: fmtEur(locale, l.paidCents!) }),
      cta: { label: t("Voir mes revenus"), href: "/revenus" },
    }));
  });
}

/** Note d'honoraires établie par l'expert : l'interlocuteur du dossier la reçoit (lien vers le dossier). */
export function notifyFeeNote(noteId: string) {
  later(async () => {
    const n = await db.feeNote.findUnique({ where: { id: noteId }, include: { projectExpert: { include: linkInclude } } });
    const l = n?.projectExpert;
    if (!n || !l) return;
    await send(await projectTeam(l.project), {
      subject: `Note d'honoraires ${n.number} de ${expertName(l.practitioner)}`,
      text: `Bonjour,\n\n${expertName(l.practitioner)} a établi sa note d'honoraires pour « ${l.project.title} » : ${fmtEur("fr", n.totalCents)} (${n.vatBp ? "TTC" : "TVA non applicable"}).\n\nElle est disponible dans le dossier ; indiquez le paiement une fois le virement fait.`,
      cta: { label: "Ouvrir le dossier", href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` },
    });
  });
}

/** Erreur signalée par un praticien sur une déclaration Transparence Santé : l'équipe conformité est prévenue. */
export function notifyTransparencyIssue(orgId: string, who: string, label: string, comment: string) {
  later(async () => {
    await send(await members(orgId, COMPLIANCE_ROLES), {
      subject: `Transparence Santé : erreur signalée par ${who}`,
      text: `Bonjour,\n\n${who} signale une erreur sur : ${label}.\n\n« ${comment} »\n\nVérifiez la déclaration avant publication (ou corrigez-la sur la plateforme Transparence Santé).`,
      cta: { label: "Ouvrir l'espace conformité", href: `/organisations/${orgId}/conformite?onglet=transparence` },
    });
  });
}

/** Nouvel avis vérifié : le prestataire est prévenu. */
export function notifySupplierReview(reviewId: string) {
  later(async () => {
    const r = await db.supplierReview.findUnique({ where: { id: reviewId }, include: { client: { select: { name: true } } } });
    if (!r) return;
    await send(await supplierTeam(r.supplierId), {
      subject: `Nouvel avis de ${r.client.name} : ${r.rating}/5`,
      text: `Bonjour,\n\n${r.client.name} a évalué votre prestation : ${r.rating}/5.${r.comment ? `\n\n« ${r.comment} »` : ""}`,
      cta: { label: "Voir ma page publique", href: `/structures/${r.supplierId}` },
    });
  });
}

/** Circuit de conformité : dossier soumis (→ conformité), validé ou bloqué (→ équipe projet). */
export function notifyCompliance(projectId: string, step: "submit" | "validate" | "block", actorId: string) {
  later(async () => {
    const p = await db.project.findUnique({ where: { id: projectId } });
    if (!p) return;
    const href = `/organisations/${p.organizationId}/dossiers/${p.id}`;
    if (step === "submit") {
      await send(await members(p.organizationId, COMPLIANCE_ROLES), {
        subject: `Dossier à valider : ${p.title}`,
        text: `Bonjour,\n\nLe dossier « ${p.title} » est soumis à la conformité.`,
        cta: { label: "Examiner le dossier", href },
      }, actorId);
    } else {
      await send(await projectTeam(p), {
        subject: `Dossier ${step === "validate" ? "validé" : "bloqué"} par la conformité : ${p.title}`,
        text: `Bonjour,\n\nLe dossier « ${p.title} » est désormais : ${STATUS_LABEL[p.status]}.${p.complianceNote ? `\n\nCommentaire : ${p.complianceNote}` : ""}`,
        cta: { label: "Ouvrir le dossier", href },
      }, actorId);
    }
  });
}

/** Demande de devis envoyée : prévient chaque prestataire consulté. */
export function notifyRfqSent(rfqId: string) {
  later(async () => {
    const r = await db.rfq.findUnique({ where: { id: rfqId }, include: { organization: { select: { name: true } }, suppliers: true } });
    if (!r) return;
    for (const s of r.suppliers) {
      const team = await db.membership.findMany({ where: { organizationId: s.supplierId }, include: { user: { select: userSelect } } });
      await send(team.map((m) => m.user), {
        subject: `Demande de devis de ${r.organization.name}`,
        text: `Bonjour,\n\n${r.organization.name} vous consulte pour une prestation.${r.deadline ? ` Réponse attendue avant le ${r.deadline.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.` : ""}`,
        cta: { label: "Répondre à la demande", href: `/organisations/${s.supplierId}/devis` },
      });
    }
  });
}

/** Devis reçu : prévient les interlocuteurs de la demande (auteur, agence de l'événement, ou organisateurs). */
export function notifyQuote(rfqId: string, supplierId: string, revised = false) {
  later(async () => {
    const [r, supplier] = await Promise.all([
      db.rfq.findUnique({ where: { id: rfqId }, include: { event: { select: { organizationId: true, agencyId: true } } } }),
      db.organization.findUnique({ where: { id: supplierId }, select: { name: true } }),
    ]);
    if (!r || !supplier) return;
    await send(await rfqContacts(r, supplierId), {
      subject: revised ? `Devis révisé par ${supplier.name}` : `Devis reçu ${de(supplier.name)}`,
      text: revised ? `Bonjour,\n\n${supplier.name} a révisé son devis.` : `Bonjour,\n\n${supplier.name} a répondu à votre demande de devis.`,
      cta: { label: "Comparer les devis", href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` },
    });
  });
}

async function supplierTeam(supplierId: string) {
  const ms = await db.membership.findMany({ where: { organizationId: supplierId }, include: { user: { select: userSelect } } });
  return ms.map((m) => m.user);
}

/** Agence à qui l'événement est confié, sous mandat actif : son équipe et son droit de retenir les devis. */
async function eventAgency(event: { organizationId: string; agencyId: string | null } | null) {
  if (!event?.agencyId) return null;
  const mandate = await db.mandate.findFirst({
    where: { mandatorId: event.organizationId, agencyId: event.agencyId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
    include: { agency: { select: { name: true } } },
  });
  if (!mandate) return null;
  return { id: event.agencyId, name: mandate.agency.name, canAward: mandate.canAward, team: await supplierTeam(event.agencyId) };
}

/**
 * Interlocuteurs d'une demande de devis côté client. L'appartenance d'une agence vient de son mandat (pas d'une
 * adhésion) : son équipe est prévenue pour les événements qui lui sont confiés, sauf quand c'est elle qui répond.
 * Côté organisation : l'auteur de la demande s'il en est membre ; sinon les organisateurs, sauf si l'agence qui l'a
 * créée peut retenir les devis (sans ce droit, ce sont eux qui décident).
 */
async function rfqContacts(rfq: { organizationId: string; createdById: string | null; event: { organizationId: string; agencyId: string | null } | null }, supplierId?: string) {
  const [organizers, agency] = await Promise.all([members(rfq.organizationId, EVENT_ORGANIZER_ROLES), eventAgency(rfq.event)]);
  const agencyTeam = agency && agency.id !== supplierId ? agency.team : [];
  const internal = organizers.find((u) => u.id === rfq.createdById);
  const byAgency = !!agency?.team.some((u) => u.id === rfq.createdById);
  return [...agencyTeam, ...(internal ? [internal] : byAgency && agency!.canAward ? [] : organizers)];
}

/** Événement confié à une agence : son équipe est prévenue et y accède aussitôt. */
export function notifyEventConfided(eventId: string) {
  later(async () => {
    const e = await db.event.findUnique({ where: { id: eventId }, include: { organization: { select: { name: true } } } });
    if (!e?.agencyId) return;
    await send(await supplierTeam(e.agencyId), {
      subject: `${e.organization.name} vous confie « ${e.title} »`,
      text: `Bonjour,\n\n${e.organization.name} confie à votre agence l'organisation de l'événement « ${e.title} » (${e.startsAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}). Vous y accédez avec votre compte KolBase : inscrits, prestataires et devis.`,
      cta: { label: "Ouvrir l'événement", href: `/organisations/${e.organizationId}/evenements/${e.id}` },
    });
  });
}

/** Événement retiré à une agence (confié à une autre, ou repris par l'organisation) : l'agence est prévenue. */
export function notifyEventWithdrawn(eventId: string, agencyId: string) {
  later(async () => {
    const e = await db.event.findUnique({ where: { id: eventId }, include: { organization: { select: { name: true } }, agency: { select: { name: true } } } });
    if (!e || e.agencyId === agencyId) return;
    await send(await supplierTeam(agencyId), {
      subject: `« ${e.title} » n'est plus confié à votre agence`,
      text: `Bonjour,\n\n${e.organization.name} ${e.agencyId ? "a confié l'événement à une autre agence" : "reprend l'organisation de l'événement"} « ${e.title} ». Votre équipe n'y a plus accès ; vos devis et échanges en tant que prestataire restent dans vos demandes de devis.`,
      cta: { label: "Voir mes demandes de devis", href: `/organisations/${agencyId}/devis?onglet=toutes` },
    });
  });
}

/** Fin de mandat : l'agence perd l'accès aux événements que l'organisation lui avait confiés. */
export function notifyMandateEnded(mandateId: string, eventTitles: string[]) {
  later(async () => {
    const m = await db.mandate.findUnique({ where: { id: mandateId }, include: { mandator: { select: { name: true } } } });
    if (!m) return;
    const list = eventTitles.length ? `\n\nÉvénements concernés : ${eventTitles.map((x) => `« ${x} »`).join(", ")}.` : "";
    await send(await supplierTeam(m.agencyId), {
      subject: `Fin du mandat ${de(m.mandator.name)}`,
      text: `Bonjour,\n\n${m.mandator.name} a mis fin au mandat de votre agence. Votre équipe n'accède plus à son espace ni aux événements qu'elle vous avait confiés.${list}`,
      cta: { label: "Voir mes demandes de devis", href: `/organisations/${m.agencyId}/devis?onglet=toutes` },
    });
  });
}

/** Résumé d'un devis : prestataire, montants HT et TTC. */
const quoteSummary = (q: { amountCents: number; vatBp: number; supplier: { name: string } }) =>
  `${q.supplier.name} : ${formatEUR(q.amountCents)} HT (${formatEUR(withVat(q.amountCents, q.vatBp))} TTC)`;

/**
 * Décision sur une demande de devis : le prestataire retenu et les autres sont prévenus. Côté client, la décision
 * prise par l'agence mandatée est annoncée aux organisateurs ; celle de l'organisation, à l'agence de l'événement.
 */
export function notifyAward(rfqId: string, actorId?: string) {
  later(async () => {
    const r = await db.rfq.findUnique({
      where: { id: rfqId },
      include: { organization: { select: { name: true } }, event: { select: { title: true, organizationId: true, agencyId: true } }, quotes: { include: { supplier: { select: { name: true } } } } },
    });
    if (!r) return;
    const what = r.event ? `pour « ${r.event.title} »` : "";
    for (const q of r.quotes) {
      const kept = q.status === "retained";
      await send(await supplierTeam(q.supplierId), {
        subject: kept ? `Votre devis est retenu par ${r.organization.name}` : `Votre devis n'est pas retenu par ${r.organization.name}`,
        text: kept
          ? `Bonjour,\n\n${r.organization.name} a retenu votre devis ${what}. Vous pouvez échanger avec l'organisation depuis la demande pour préparer la prestation.`
          : `Bonjour,\n\n${r.organization.name} a retenu une autre offre ${what}. Merci pour votre proposition.`,
        cta: { label: "Voir la demande", href: `/organisations/${q.supplierId}/devis?onglet=toutes` },
      });
    }
    const kept = r.quotes.find((q) => q.status === "retained");
    const agency = await eventAgency(r.event);
    if (!kept || !actorId || !agency) return;
    const href = `/organisations/${r.organizationId}/prestataires#rfq-${r.id}`;
    const others = r.quotes.length - 1;
    const rest = others > 0 ? ` ${others} autre${others > 1 ? "s" : ""} devis ${others > 1 ? "sont écartés" : "est écarté"}.` : "";
    if (agency.team.some((u) => u.id === actorId)) {
      await send(await members(r.organizationId, EVENT_ORGANIZER_ROLES), {
        subject: `${agency.name} a retenu un devis ${what}`.trim(),
        text: `Bonjour,\n\n${agency.name}, agence mandatée, a retenu en votre nom le devis ${de(quoteSummary(kept))}.${rest}\n\nVous pouvez retirer ce droit à l'agence dans Prestataires › Agences mandatées.`,
        cta: { label: "Voir la demande", href },
      }, actorId);
    } else if (agency.id !== kept.supplierId) {
      await send(agency.team, {
        subject: `${r.organization.name} a retenu un devis ${what}`.trim(),
        text: `Bonjour,\n\n${r.organization.name} a retenu le devis ${de(quoteSummary(kept))}.${rest}`,
        cta: { label: "Voir la demande", href },
      }, actorId);
    }
  });
}

/** Devis proposé par l'agence mandatée (sans droit de retenir) : les organisateurs décident. */
export function notifyQuoteProposed(rfqId: string, actorId: string) {
  later(async () => {
    const r = await db.rfq.findUnique({ where: { id: rfqId }, include: { event: { select: { title: true, organizationId: true, agencyId: true } }, quotes: { include: { supplier: { select: { name: true } } } } } });
    const q = r?.quotes.find((x) => x.id === r.proposedQuoteId);
    const agency = await eventAgency(r?.event ?? null);
    if (!r || !q || !agency) return;
    await send(await members(r.organizationId, EVENT_ORGANIZER_ROLES), {
      subject: `Devis à retenir : ${agency.name} propose ${q.supplier.name}`,
      text: `Bonjour,\n\n${agency.name}, agence mandatée${r.event ? ` pour « ${r.event.title} »` : ""}, vous propose de retenir le devis ${de(quoteSummary(q))}. La décision vous revient : retenez ce devis ou un autre depuis la demande.`,
      cta: { label: "Décider", href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` },
    }, actorId);
  });
}

/** Demande annulée : les prestataires consultés ne travaillent plus dessus. */
export function notifyRfqCancelled(rfqId: string) {
  later(async () => {
    const r = await db.rfq.findUnique({ where: { id: rfqId }, include: { organization: { select: { name: true } }, suppliers: true } });
    if (!r) return;
    for (const s of r.suppliers) {
      if (s.declined) continue;
      await send(await supplierTeam(s.supplierId), {
        subject: `Demande de devis annulée par ${r.organization.name}`,
        text: `Bonjour,\n\n${r.organization.name} a annulé sa demande de devis. Aucune réponse n'est plus attendue.`,
        cta: { label: "Voir mes demandes", href: `/organisations/${s.supplierId}/devis?onglet=toutes` },
      });
    }
  });
}

/** Question ou réponse sur une demande de devis : prévient l'autre partie du fil. */
export function notifyRfqMessage(rfqId: string, supplierId: string, fromSupplier: boolean, authorId: string) {
  later(async () => {
    const [r, supplier] = await Promise.all([
      db.rfq.findUnique({ where: { id: rfqId }, include: { organization: { select: { name: true } }, event: { select: { organizationId: true, agencyId: true } } } }),
      db.organization.findUnique({ where: { id: supplierId }, select: { name: true } }),
    ]);
    if (!r || !supplier) return;
    if (fromSupplier) {
      await send(await rfqContacts(r, supplierId), {
        subject: `Question ${de(supplier.name)} sur votre demande de devis`,
        text: `Bonjour,\n\n${supplier.name} vous a écrit au sujet de votre demande de devis.`,
        cta: { label: "Répondre", href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` },
      }, authorId);
    } else {
      await send(await supplierTeam(supplierId), {
        subject: `Message ${de(r.organization.name)} sur une demande de devis`,
        text: `Bonjour,\n\n${r.organization.name} vous a écrit au sujet de sa demande de devis.`,
        cta: { label: "Répondre", href: `/organisations/${supplierId}/devis` },
      }, authorId);
    }
  });
}

// ─── E-mails de service (toujours envoyés) ─────────────────────────────────

/** Invitation à rejoindre une organisation, quand l'adresse est connue. */
export function notifyInvitation(email: string, orgName: string, inviterName: string, link: string) {
  later(async () => {
    await sendMail({
      to: email,
      subject: `${inviterName} vous invite à rejoindre ${orgName} sur KolBase`,
      text: `Bonjour,\n\n${inviterName} vous invite à rejoindre l'espace de ${orgName} sur KolBase. Le lien est valable 14 jours et ne sert qu'une fois.`,
      cta: { label: "Rejoindre l'organisation", href: link },
    });
  });
}

/** Administrateurs de la plateforme : une organisation ou un RPPS attend une validation. */
export function notifyPlatformAdmins(subject: string, text: string, href: string) {
  later(async () => {
    for (const to of platformAdminEmails()) await sendMail({ to, subject, text: `Bonjour,\n\n${text}`, cta: { label: "Ouvrir l'administration", href } });
  });
}

// ─── Décisions de l'équipe KolBase (toujours envoyées : elles concernent le compte) ───

/** Envoi à chaque destinataire, sans tenir compte de la préférence de notifications (e-mail de service). */
async function sendService(recipients: Recipient[], mail: Omit<Mail, "to"> | Compose) {
  const seen = new Set<string>();
  for (const u of recipients) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const locale: Locale = isLocale(u.locale) ? u.locale : "fr";
    await sendMail({ ...(typeof mail === "function" ? mail(makeT(locale), locale) : mail), to: u.email, locale });
  }
}

/** Validation, refus, suspension ou réactivation d'une organisation : ses administrateurs sont prévenus (motif compris). */
export function notifyOrgDecision(orgId: string, decision: "verify" | "reject" | "suspend" | "reactivate", note: string | null) {
  later(async () => {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true, kind: true, listed: true } });
    if (!org) return;
    const supplier = org.kind === "PRESTATAIRE";
    const motif = note ? `\n\nMotif : ${note}` : "";
    const mail =
      decision === "verify"
        ? {
            subject: `${org.name} est validée sur KolBase`,
            text: `Bonjour,\n\nL'équipe KolBase a validé ${org.name}.${note ? `\n\nNote de l'équipe KolBase : ${note}` : ""}\n\n${
              supplier
                ? `Vous pouvez répondre aux demandes de devis des organisations${org.listed ? " ; votre fiche figure dans l'annuaire des prestataires" : " et vous référencer dans l'annuaire des prestataires (catégories de prestation) depuis la page Devis"}.`
                : "Vous pouvez désormais solliciter des experts, publier vos événements et vos appels à candidatures, et consulter des prestataires. Votre page publique est en ligne ; vous pouvez la retirer de l'annuaire dans Membres et réglages."
            }`,
            cta: { label: supplier ? "Ouvrir mes demandes de devis" : "Ouvrir l'espace de l'organisation", href: supplier ? `/organisations/${orgId}/devis` : `/organisations/${orgId}` },
          }
        : decision === "reject"
          ? {
              subject: `${org.name} n'a pas été validée sur KolBase`,
              text: `Bonjour,\n\nL'équipe KolBase n'a pas pu valider ${org.name}.${motif}\n\nCorrigez l'identité de l'organisation (SIREN, nom) dans Membres et réglages : la demande sera examinée de nouveau. Pour toute question, répondez à cet e-mail.`,
              cta: { label: "Corriger l'identité de l'organisation", href: `/organisations/${orgId}/membres?onglet=organisation` },
            }
          : decision === "suspend"
            ? {
                subject: `${org.name} est suspendue sur KolBase`,
                text: `Bonjour,\n\nL'équipe KolBase a suspendu ${org.name}.${motif}\n\nPendant la suspension, votre page publique, vos événements et vos appels à candidatures sont masqués, et l'organisation ne peut plus solliciter d'experts, publier ni envoyer de demandes de devis. Rien n'est supprimé : tout réapparaît tel quel à la réactivation. Pour en discuter, répondez à cet e-mail.`,
                cta: { label: "Voir l'organisation", href: `/organisations/${orgId}` },
              }
            : {
                subject: `${org.name} est de nouveau active sur KolBase`,
                text: `Bonjour,\n\nL'équipe KolBase a levé la suspension de ${org.name}. ${supplier ? "Votre fiche prestataire est de nouveau visible et vous pouvez répondre aux demandes de devis." : "Votre page publique, vos événements et vos appels à candidatures sont de nouveau visibles ; vous pouvez de nouveau solliciter des experts, publier et consulter des prestataires."}`,
                cta: { label: "Ouvrir l'espace de l'organisation", href: `/organisations/${orgId}` },
              };
    await sendService(await members(orgId, ["ADMIN"]), mail);
  });
}

/** Identité professionnelle d'un praticien vérifiée ou refusée (motif et consigne). */
export function notifyIdentityDecision(practitionerId: string, verified: boolean, note: string | null) {
  later(async () => {
    const p = await db.practitionerProfile.findUnique({ where: { id: practitionerId }, include: { user: { select: userSelect } } });
    if (!p) return;
    await sendService([p.user], (t) =>
      verified
        ? {
            subject: t("Votre identité est vérifiée sur KolBase"),
            text: `${t("Bonjour,")}\n\n${t("L'équipe KolBase a vérifié votre identifiant professionnel : le badge « Identité vérifiée » s'affiche sur votre fiche d'expert.")}`,
            cta: { label: t("Voir mon compte"), href: "/compte" },
          }
        : {
            subject: t("Votre identifiant professionnel n'a pas pu être vérifié"),
            text: [
              t("Bonjour,"),
              t("L'équipe KolBase n'a pas pu vérifier votre identifiant professionnel."),
              note ? t("Motif : {note}", { note }) : null,
              t("Corrigez-le dans « Mon compte › Informations personnelles » (nom, profession, identifiant tels qu'ils figurent au registre), puis référencez-vous de nouveau : il sera contrôlé à nouveau."),
            ].filter(Boolean).join("\n\n"),
            cta: { label: t("Corriger mes informations"), href: "/compte" },
          },
    );
  });
}

/** Gratuité de l'abonnement offerte ou retirée par l'équipe KolBase : les administrateurs de l'organisation sont prévenus. */
export function notifyExemption(orgId: string, until: Date | null, note: string | null) {
  later(async () => {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true, kind: true } });
    if (!org) return;
    const actions = org.kind === "PRESTATAIRE" ? "répondre aux demandes de devis" : "solliciter des experts, publier vos événements et vos appels, envoyer des demandes de devis";
    const date = until?.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
    await sendService(await members(orgId, ["ADMIN"]), until
      ? {
          subject: `KolBase vous offre l'abonnement jusqu'au ${date}`,
          text: `Bonjour,\n\nL'équipe KolBase offre l'abonnement de ${org.name} jusqu'au ${date}${note ? ` (${note})` : ""}. D'ici là, vous pouvez ${actions} sans rien payer.`,
          cta: { label: "Voir l'abonnement", href: `/organisations/${orgId}/abonnement` },
        }
      : {
          subject: "KolBase : gratuité de l'abonnement retirée",
          text: `Bonjour,\n\nL'abonnement de ${org.name} n'est plus offert par l'équipe KolBase. Pour continuer à ${actions}, un administrateur active l'abonnement depuis la page Abonnement. Vos dossiers, événements et échanges restent accessibles.`,
          cta: { label: "Voir l'abonnement", href: `/organisations/${orgId}/abonnement` },
        });
  });
}

// ─── Avant et après l'événement (tâche planifiée ou envoi par l'organisateur) ───

/** Rappel aux inscrits pas encore prévenus : date, lieu, programme, badge d'accueil. Renvoie le nombre d'inscriptions traitées. */
export async function sendEventReminders(eventId: string, now = new Date()) {
  const ev = await db.event.findUnique({
    where: { id: eventId },
    include: { organization: { select: { name: true } }, registrations: { where: { reminderSentAt: null }, include: { user: { select: { ...userSelect, firstName: true } } } } },
  });
  if (!ev || ev.internal || ev.startsAt <= now) return 0;
  const inPerson = ev.format !== "DISTANCIEL";
  const program = ev.program ? (ev.program.length > 700 ? `${ev.program.slice(0, 700).trimEnd()}…` : ev.program) : null;
  for (const r of ev.registrations) {
    await send([r.user], (t, locale) => {
      const when = ev.startsAt.toLocaleString(locale === "en" ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      const place = ev.format === "DISTANCIEL" ? null : t("Lieu : {place}", { place: [ev.venue, ev.city].filter(Boolean).join(", ") || t("à préciser par l'organisateur") });
      // Lien de connexion (en ligne, hybride) : réservé aux inscrits, donné dans le rappel.
      const online = ev.format === "PRESENTIEL" ? null : ev.onlineUrl ? t("Lien de connexion : {url}", { url: ev.onlineUrl }) : t("En ligne : le lien de connexion vous est communiqué par l'organisateur.");
      return {
        subject: t("Rappel : « {title} », {when}", { title: ev.title, when }),
        text: [
          t("Bonjour {name},", { name: r.user.firstName }),
          t("Vous êtes inscrit à « {title} » ({org}), {when}.", { title: ev.title, org: ev.organization.name, when }),
          place,
          online,
          program ? `${t("Programme")} :\n${program}` : null,
          inPerson ? t("À l'accueil, présentez votre badge : le lien ci-dessous l'affiche sur votre téléphone.") : null,
        ].filter(Boolean).join("\n\n"),
        cta: inPerson ? { label: t("Mon badge d'accueil"), href: `/inscriptions/${r.id}/badge` } : { label: t("Voir l'événement"), href: `/evenements/${ev.id}` },
      };
    });
    await db.registration.update({ where: { id: r.id }, data: { reminderSentAt: now } });
  }
  return ev.registrations.length;
}

/** Événement modifié (date, heure, lieu, format ou lien de connexion) : chaque inscrit reçoit les nouvelles informations. */
export function notifyEventChanged(eventId: string, changes: EventChange[]) {
  later(async () => {
    const ev = await db.event.findUnique({
      where: { id: eventId },
      include: { organization: { select: { name: true } }, registrations: { include: { user: { select: { ...userSelect, firstName: true } } } } },
    });
    if (!ev || ev.internal) return;
    for (const r of ev.registrations) {
      await send([r.user], (t, locale) => {
        const when = ev.startsAt.toLocaleString(locale === "en" ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const place = [ev.venue, ev.city].filter(Boolean).join(", ");
        const lines = [
          changes.includes("date") ? t("Nouvelle date : {when}.", { when }) : null,
          changes.includes("format") ? t("Nouveau format : {format}.", { format: t(FORMAT_LABEL[ev.format]) }) : null,
          (changes.includes("lieu") || changes.includes("format")) && ev.format !== "DISTANCIEL" ? t("Lieu : {place}", { place: place || t("à préciser par l'organisateur") }) : null,
          (changes.includes("lien") || changes.includes("format")) && ev.format !== "PRESENTIEL"
            ? ev.onlineUrl ? t("Lien de connexion : {url}", { url: ev.onlineUrl }) : t("En ligne : le lien de connexion vous est communiqué par l'organisateur.")
            : null,
        ];
        return {
          subject: t("Changement : « {title} »", { title: ev.title }),
          text: [
            t("Bonjour {name},", { name: r.user.firstName }),
            t("{org} a modifié « {title} », auquel vous êtes inscrit.", { org: ev.organization.name, title: ev.title }),
            lines.filter(Boolean).join("\n"),
            t("Si vous ne pouvez plus y participer, annulez votre inscription depuis la page de l'événement."),
          ].filter(Boolean).join("\n\n"),
          cta: { label: t("Voir l'événement"), href: `/evenements/${ev.id}` },
        };
      });
    }
  });
}

/**
 * Après l'événement : remerciement, attestation de présence (présents au pointage) et questionnaire.
 * Si personne n'a été pointé, le questionnaire part à tous les inscrits (sans attestation).
 */
export async function sendEventFollowUps(eventId: string, now = new Date()) {
  const ev = await db.event.findUnique({
    where: { id: eventId },
    include: { organization: { select: { name: true } }, registrations: { include: { user: { select: { ...userSelect, firstName: true } } } } },
  });
  if (!ev || ev.internal) return 0;
  const pointed = ev.registrations.some((r) => r.checkedInAt);
  const targets = ev.registrations.filter((r) => !r.followUpSentAt && (!pointed || r.checkedInAt));
  for (const r of targets) {
    await send([r.user], (t) => ({
      subject: t("Merci pour votre participation à « {title} »", { title: ev.title }),
      text: [
        t("Bonjour {name},", { name: r.user.firstName }),
        t("Merci d'avoir participé à « {title} » ({org}).", { title: ev.title, org: ev.organization.name }),
        r.checkedInAt ? t("Votre attestation de présence est disponible dans « Mes inscriptions ».") : null,
        t("Votre avis aide l'organisateur à améliorer les prochaines éditions : une minute suffit, vos réponses lui sont transmises sans votre nom."),
      ].filter(Boolean).join("\n\n"),
      cta: { label: t("Donner mon avis"), href: `/evenements/${ev.id}/avis` },
    }));
    await db.registration.update({ where: { id: r.id }, data: { followUpSentAt: now } });
  }
  return targets.length;
}

// ─── Abonnement ──────────────────────────────────────────────────────────────

/** Premier devis retenu d'un prestataire : l'abonnement (premier mois offert) est à activer pour continuer. */
export function notifySupplierBilling(supplierId: string, client: string) {
  later(async () => {
    await send(await members(supplierId, ["ADMIN"]), {
      subject: `Félicitations : ${client} a retenu votre devis`,
      text: `Bonjour,\n\nVotre premier devis retenu via KolBase, bravo !\n\nLe référencement reste gratuit ; pour continuer à répondre à de nouvelles demandes, activez votre abonnement prestataire (249 € HT par mois, premier mois offert, sans engagement). La prestation retenue et vos échanges en cours ne sont pas concernés.`,
      cta: { label: "Activer mon abonnement", href: `/organisations/${supplierId}/abonnement` },
    });
  });
}

/** Échec de paiement signalé par Stripe : les administrateurs mettent à jour leur moyen de paiement. */
export function notifyPaymentFailed(orgId: string) {
  later(async () => {
    await send(await members(orgId, ["ADMIN"]), {
      subject: "KolBase : le paiement de votre abonnement a échoué",
      text: "Bonjour,\n\nLe dernier prélèvement de votre abonnement KolBase n'a pas abouti. Stripe va réessayer ; pour éviter toute interruption, vérifiez votre moyen de paiement.",
      cta: { label: "Gérer mon abonnement", href: `/organisations/${orgId}/abonnement` },
    });
  });
}

// ─── Services KolBase ────────────────────────────────────────────────────────

/** Suivi d'une commande de service : la personne qui l'a passée est prévenue (planifiée, refusée, réalisée). */
export function notifyServiceOrder(orderId: string) {
  later(async () => {
    const o = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { event: { select: { id: true, title: true, organizationId: true } } } });
    if (!o) return;
    const user = await db.user.findUnique({ where: { id: o.orderedById }, select: userSelect });
    if (!user) return;
    const what = `« ${o.label} » pour « ${o.event.title} »`;
    const text =
      o.status === "planifiee" ? `L'équipe KolBase a planifié ${what}${o.plannedAt ? ` : réalisation prévue le ${o.plannedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" })}` : ""}.${o.adminNote ? `\n\n${o.adminNote}` : ""}`
      : o.status === "refusee" ? `L'équipe KolBase ne peut pas réaliser ${what}.\n\n${o.adminNote ?? ""}`
      : o.status === "realisee" ? `L'équipe KolBase a réalisé ${what}.${o.resultUrl ? `\n\nRésultat : ${o.resultUrl}` : ""}${o.adminNote ? `\n\n${o.adminNote}` : ""}${o.priceCents > 0 ? `\n\nMontant : ${(o.priceCents / 100).toLocaleString("fr-FR")} € HT, sur votre prochaine facture.` : ""}`
      : null;
    if (!text) return;
    await send([user], { subject: `Service KolBase : ${o.label}`, text: `Bonjour,\n\n${text}`, cta: { label: "Voir l'événement", href: `/organisations/${o.event.organizationId}/evenements/${o.event.id}` } });
  });
}

/** Bilan d'un service réalisé, envoyé à la personne qui l'a commandé (et aux organisateurs si elle n'est plus membre). */
export async function sendServiceReport(orderId: string, now = new Date()) {
  const o = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { offer: { select: { kind: true } }, event: { select: { id: true, title: true, startsAt: true, organizationId: true } } } });
  if (!o || o.status !== "realisee" || o.reportSentAt || !o.doneAt) return false;
  const s = (await orderStats([o])).get(o.id)!;
  const done = o.doneAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" });
  const rate = conversion(s);
  const lines = [
    `Voici le bilan de « ${o.label} » pour « ${o.event.title} », réalisé le ${done}.`,
    "",
    ...reportParts(s, o.offer.kind).map((p) => `- ${p.key.replace("{n}", p.n.toLocaleString("fr-FR"))}`),
    ...(rate != null ? [`- ${rate} % des visiteurs se sont inscrits`] : []),
    ...(s.since != null ? [`- ${s.since} inscription${s.since > 1 ? "s" : ""} à l'événement au total depuis le ${done}`] : []),
    "",
    "Les visiteurs sont comptés une fois (robots et aperçus de liens exclus) ; une inscription est attribuée au service quand elle suit un clic sur son lien dans les 30 jours.",
    ...(o.event.startsAt > now ? ["", "Pour relancer avant l'événement, vous pouvez commander un nouveau service depuis la fiche de l'événement."] : []),
  ];
  const orderer = await db.user.findUnique({ where: { id: o.orderedById }, select: { ...userSelect, memberships: { where: { organizationId: o.organizationId }, select: { id: true } } } });
  const to = orderer && orderer.memberships.length > 0 ? [orderer] : await members(o.organizationId, EVENT_ORGANIZER_ROLES);
  await send(to, { subject: `Bilan : ${o.label} — ${o.event.title}`, text: `Bonjour,\n\n${lines.join("\n")}`, cta: { label: "Voir l'événement", href: `/organisations/${o.event.organizationId}/evenements/${o.event.id}#services` } });
  await db.serviceOrder.update({ where: { id: o.id }, data: { reportSentAt: now } });
  return true;
}
