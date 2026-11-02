import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { sendMail, type Mail } from "@/lib/mail";
import { platformAdminEmails } from "@/lib/platform";
import { drPrefix } from "@/lib/professions";
import { COMPLIANCE_ROLES, EVENT_ORGANIZER_ROLES } from "@/lib/events";
import { fmtEur, isLocale, makeT, type Locale, type T } from "@/lib/i18n";
import { PROJECT_ROLES, SOURCING_ROLES, STATUS_LABEL } from "@/lib/projects";
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

const expertName = (p: { profession: string; user: { firstName: string; lastName: string } }) => `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}`;

const linkInclude = {
  project: { include: { organization: { select: { name: true } } } },
  practitioner: { include: { user: { select: { ...userSelect, firstName: true, lastName: true } } } },
} as const;

// ─── Praticiens ────────────────────────────────────────────────────────────

/** Nouvelle sollicitation (dossier ouvert par une organisation) ou honoraires proposés après une candidature retenue. */
export function notifySolicitations(projectId: string, kind: "sollicitation" | "honoraires" = "sollicitation") {
  later(async () => {
    const links = await db.projectExpert.findMany({ where: { projectId, status: "ATT_EXPERTS" }, include: linkInclude });
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
      text: accepted
        ? `Bonjour,\n\n${expertName(l.practitioner)} a donné son accord de principe pour « ${l.project.title} ». Vous pouvez soumettre le dossier à la conformité.`
        : `Bonjour,\n\n${expertName(l.practitioner)} a décliné « ${l.project.title} ».${l.responseNote ? `\n\nSon message : ${l.responseNote}` : ""}`,
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

/** Nouvelle candidature à un appel ouvert. */
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

/** Nouvelle candidature d'intervenant. */
export function notifySpeakerApplication(eventId: string, practitionerId: string) {
  later(async () => {
    const [ev, prac] = await Promise.all([
      db.event.findUnique({ where: { id: eventId } }),
      db.practitionerProfile.findUnique({ where: { id: practitionerId }, include: { user: { select: { firstName: true, lastName: true } } } }),
    ]);
    if (!ev || !prac) return;
    await send(await members(ev.organizationId, EVENT_ORGANIZER_ROLES), {
      subject: `Candidature d'intervenant : ${ev.title}`,
      text: `Bonjour,\n\n${expertName(prac)} propose d'intervenir lors de « ${ev.title} ».`,
      cta: { label: "Voir l'appel à intervenants", href: `/organisations/${ev.organizationId}/intervenants` },
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

/** Devis reçu : prévient l'auteur de la demande (ou les organisateurs). */
export function notifyQuote(rfqId: string, supplierId: string, revised = false) {
  later(async () => {
    const [r, supplier] = await Promise.all([db.rfq.findUnique({ where: { id: rfqId } }), db.organization.findUnique({ where: { id: supplierId }, select: { name: true } })]);
    if (!r || !supplier) return;
    const team = await members(r.organizationId, EVENT_ORGANIZER_ROLES);
    const creator = team.find((u) => u.id === r.createdById);
    await send(creator ? [creator] : team, {
      subject: revised ? `Devis révisé par ${supplier.name}` : `Devis reçu de ${supplier.name}`,
      text: revised ? `Bonjour,\n\n${supplier.name} a révisé son devis.` : `Bonjour,\n\n${supplier.name} a répondu à votre demande de devis.`,
      cta: { label: "Comparer les devis", href: `/organisations/${r.organizationId}/prestataires` },
    });
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
