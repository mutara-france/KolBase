import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { sendMail, type Mail } from "@/lib/mail";
import { platformAdminEmails } from "@/lib/platform";
import { drPrefix } from "@/lib/professions";
import { COMPLIANCE_ROLES, EVENT_ORGANIZER_ROLES, FORMAT_LABEL, formatEUR, type EventChange } from "@/lib/events";
import { de } from "@/lib/elision";
import { appUrl, eventIcsEntry, toIcs } from "@/lib/ics";
import { quoteTtc } from "@/lib/quotes";
import { PLANS } from "@/lib/billing-plans";
import { rnaAccepted } from "@/lib/org-roles";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { fmtEur, intlLocale, isLocale, makeT, type Locale, type T } from "@/lib/i18n";
import { collabType, PROJECT_ROLES, SOURCING_ROLES, STATUS_LABEL, type ExpertNotice } from "@/lib/projects";
import { featuredUntil, orderStats } from "@/lib/services";
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

/**
 * Envoi unique d'un message suivi par une date (rappel, remerciement, bilan). La date est posée avant l'envoi, si elle
 * est encore vide : deux passages simultanés (tâche planifiée, envoi par l'organisateur, nouvel essai) n'envoient pas
 * deux fois. Elle est retirée si l'envoi échoue, pour que le passage suivant réessaie.
 */
async function sendOnce(claim: () => Promise<{ count: number }>, release: () => Promise<unknown>, deliver: () => Promise<void>) {
  if ((await claim()).count === 0) return false;
  try {
    await deliver();
  } catch (e) {
    await release();
    throw e;
  }
  return true;
}

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
        const units = l.days != null ? ` ${t("Prestation : {n} {unit}.", { n: l.days.toLocaleString(locale === "en" ? "en-GB" : "fr-FR"), unit: unitLabel(t, l.project.typeId, l.days) })}` : "";
        const fee = `${units}${l.feeCents != null ? ` ${t("Honoraires proposés : {montant} HT.", { montant: fmtEur(locale, l.feeCents) })}` : ""}`;
        return {
          subject: kind === "honoraires" ? t("Candidature retenue : {org} vous propose des honoraires", { org }) : t("Nouvelle sollicitation {de_org}", { org, de_org: de(org) }),
          text:
            kind === "honoraires"
              ? `${t("Bonjour,")}\n\n${t("{org} a retenu votre candidature « {titre} ».", { org, titre: title })}${fee}\n\n${t("Acceptez, proposez d'autres honoraires ou déclinez sur KolBase : le dossier n'avance qu'après votre réponse.")}`
              : `${t("Bonjour,")}\n\n${t("{org} vous sollicite pour « {titre} ».", { org, titre: title })}${fee}\n\n${t("Vous pouvez accepter, proposer d'autres honoraires, décliner ou poser vos questions sur KolBase.")}`,
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
      subject: t("Nouvelle proposition {de_org}", { org, de_org: de(org) }),
      text: [
        t("Bonjour,"),
        t("{org} a modifié sa proposition pour « {titre} ».", { org, titre: l.project.title }),
        [
          l.days != null ? t("Prestation : {n} {unit}.", { n: l.days.toLocaleString(locale === "en" ? "en-GB" : "fr-FR"), unit: unitLabel(t, l.project.typeId, l.days) }) : null,
          // Ancien montant rappelé : « 1 500 € → 1 800 € HT ».
          l.feeCents != null ? t("Honoraires proposés : {montant} HT.", { montant: l.previousFeeCents != null ? `${fmtEur(locale, l.previousFeeCents)} → ${fmtEur(locale, l.feeCents)}` : fmtEur(locale, l.feeCents) }) : null,
        ].filter(Boolean).join(" "),
        t("Votre réponse précédente ne vaut plus pour ces nouvelles conditions : acceptez, proposez d'autres honoraires ou déclinez sur KolBase."),
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
      await send(await projectTeam(l.project), (t) => ({ subject: t("Nouveau message de {expert}", { expert: expertName(l.practitioner) }), text: t("Bonjour,\n\n{expert} vous a écrit à propos du dossier « {project} ».", { expert: expertName(l.practitioner), project: l.project.title }), cta: { label: t("Lire le message"), href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` } }), authorId);
    } else {
      const org = l.project.organization.name;
      await send([l.practitioner.user], (t) => ({
        subject: t("Nouveau message {de_org}", { org, de_org: de(org) }),
        text: `${t("Bonjour,")}\n\n${t("{org} vous a écrit à propos de « {titre} ».", { org, titre: l.project.title })}`,
        cta: { label: t("Lire le message"), href: `/sollicitations/${l.id}` },
      }), authorId);
    }
  });
}

/**
 * Étape du dossier qui concerne l'expert engagé ou sollicité : abandon (avec le motif), retour en accord de principe,
 * passage en signature (convention à déposer à la main), dossier signé, recrutement clos sans sa réponse.
 */
export function notifyExpertNotice(linkIds: string[], notice: ExpertNotice, note?: string | null) {
  later(async () => {
    const links = await db.projectExpert.findMany({ where: { id: { in: linkIds } }, include: linkInclude });
    for (const l of links) {
      const org = l.project.organization.name;
      const titre = l.project.title;
      await send([l.practitioner.user], (t) => {
        const body: Record<ExpertNotice, { subject: string; lines: (string | null)[] }> = {
          abandon: {
            subject: t("Dossier abandonné : {titre}", { titre }),
            lines: [t("{org} a abandonné le dossier « {titre} ».", { org, titre }), note ? t("Motif : {note}", { note }) : null, t("La sollicitation est close : aucune suite n'est attendue de votre part.")],
          },
          retour_accord: {
            subject: t("Conditions à revoir : {titre}", { titre }),
            lines: [t("{org} remet le dossier « {titre} » en accord de principe pour en revoir les conditions. Il repassera par la conformité avant la signature ; vous serez prévenu de la suite.", { org, titre })],
          },
          signature: {
            subject: t("Convention à signer : {titre}", { titre }),
            lines: [t("Le dossier « {titre} » ({org}) passe en signature. Signez la convention, puis déposez-la signée dans KolBase (Documents de votre sollicitation) : l'organisation confirme ensuite la signature.", { org, titre })],
          },
          signe: {
            subject: t("Dossier signé : {titre}", { titre }),
            lines: [t("{org} confirme la signature de la convention pour « {titre} » : la prestation peut avoir lieu.", { org, titre })],
          },
          proposition_acceptee: {
            subject: t("Proposition acceptée : {titre}", { titre }),
            lines: [t("{org} accepte votre proposition « {titre} ». Le dossier est ouvert : l'organisation le soumet à sa conformité, puis la convention vous sera soumise.", { org, titre })],
          },
          proposition_declinee: {
            subject: t("Proposition déclinée : {titre}", { titre }),
            lines: [
              t("{org} ne donne pas suite à votre proposition « {titre} ».", { org, titre }),
              note ? t("Motif : {note}", { note }) : null,
              t("Vous pouvez la proposer à d'autres organisations depuis « Mes propositions »."),
            ],
          },
          recrutement_clos: {
            subject: t("Recrutement clos : {titre}", { titre }),
            lines: [
              l.desiredFeeCents != null
                ? t("{org} a clos le recrutement du dossier « {titre} » sans donner suite à votre proposition d'honoraires.", { org, titre })
                : t("{org} a clos le recrutement du dossier « {titre} » sans votre réponse : la sollicitation n'est plus ouverte.", { org, titre }),
              t("Si l'organisation souhaite toujours travailler avec vous, elle vous sollicitera de nouveau."),
            ],
          },
        };
        const b = body[notice];
        return { subject: b.subject, text: [t("Bonjour,"), ...b.lines].filter(Boolean).join("\n\n"), cta: { label: t("Voir la sollicitation"), href: `/sollicitations/${l.id}` } };
      });
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
    await send(await projectTeam(l.project), (t) => ({ subject: `${expertName(l.practitioner)} ${accepted ? t("a donné son accord de principe") : t("a décliné")} — ${l.project.title}`, text: accepted ? t("Bonjour,\n\n{expert} a donné son accord de principe pour « {project} ». Vous pouvez soumettre le dossier à la conformité.", { expert: expertName(l.practitioner), project: l.project.title }) : t("Bonjour,\n\n{expert} a décliné « {project} ».{v}", { expert: expertName(l.practitioner), project: l.project.title, v: l.responseNote ? t("\n\nSon message : {responseNote}", { responseNote: l.responseNote }) : "" }), cta: { label: t("Ouvrir le dossier"), href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` } }));
  });
}

/** Convention signée déposée par l'expert lui-même : l'équipe Projets vérifie et confirme la signature du dossier. */
export function notifyConventionDeposited(linkId: string) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l) return;
    await send(await projectTeam(l.project), (t) => ({ subject: t("Convention signée déposée par {expert} — {project}", { expert: expertName(l.practitioner), project: l.project.title }), text: t("Bonjour,\n\n{expert} a déposé sa convention signée pour « {project} ». Vérifiez-la dans les documents du dossier, puis passez le dossier en « Signé » une fois toutes les conventions réunies.", { expert: expertName(l.practitioner), project: l.project.title }), cta: { label: t("Ouvrir le dossier"), href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` } }));
  });
}

/**
 * Compte d'un expert supprimé : il est retiré des dossiers non signés où il était engagé ou sollicité, et de ses
 * candidatures. L'équipe Projets de chaque organisation concernée est prévenue (nom figé avant l'anonymisation).
 */
export function notifyExpertRemoved(expert: string, projects: { id: string; organizationId: string; createdById: string | null; title: string; outcome: "reopened" | "closed" | null }[], calls: { id: string; organizationId: string; createdById: string | null; title: string }[]) {
  later(async () => {
    for (const p of projects) {
      await send(await projectTeam(p), (t) => ({ subject: t("{expert} a supprimé son compte — {title}", { expert, title: p.title }), text: t("Bonjour,\n\n{expert} a supprimé son compte KolBase : il est retiré du dossier « {title} ».{v}", { expert, title: p.title, v: p.outcome === "reopened" ? t(" Plus aucun expert n'y est engagé : le dossier revient en attente des experts. Sollicitez un autre expert ou abandonnez le dossier.") : p.outcome === "closed" ? t(" Plus aucun expert n'y reste sollicité : le dossier est clos (décliné).") : "" }), cta: { label: t("Ouvrir le dossier"), href: `/organisations/${p.organizationId}/dossiers/${p.id}` } }));
    }
    for (const c of calls) {
      const team = await members(c.organizationId, SOURCING_ROLES);
      const creator = team.find((u) => u.id === c.createdById);
      await send(creator ? [creator] : team, (t) => ({ subject: t("{expert} a supprimé son compte — {title}", { expert, title: c.title }), text: t("Bonjour,\n\n{expert} a supprimé son compte KolBase : sa candidature à « {title} » est retirée.", { expert, title: c.title }), cta: { label: t("Voir l'opportunité"), href: `/organisations/${c.organizationId}/opportunites/${c.id}` } }));
    }
  });
}

/** Contre-proposition d'un expert : l'équipe Projets accepte ces honoraires ou renvoie une proposition. */
export function notifyExpertCounter(linkId: string) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l?.desiredFeeCents) return;
    await send(await projectTeam(l.project), (t, locale) => ({ subject: t("{expert} propose d'autres honoraires — {project}", { expert: expertName(l.practitioner), project: l.project.title }), text: t("Bonjour,\n\n{expert} propose d'autres honoraires pour « {project} » : {before}{montant} HT.{v}\n\nLa sollicitation reste ouverte : acceptez ces honoraires, ou proposez d'autres conditions depuis le dossier.", { expert: expertName(l.practitioner), project: l.project.title, before: l.feeCents != null ? `${fmtEur(locale, l.feeCents)} → ` : "", montant: fmtEur(locale, l.desiredFeeCents ?? 0), v: l.responseNote ? t("\n\nSon message : {responseNote}", { responseNote: l.responseNote }) : "" }), cta: { label: t("Ouvrir le dossier"), href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` } }));
  });
}

/** Honoraires de l'expert acceptés par l'organisation : il est engagé. */
export function notifyCounterAccepted(linkId: string) {
  later(async () => {
    const l = await db.projectExpert.findUnique({ where: { id: linkId }, include: linkInclude });
    if (!l || l.feeCents == null) return;
    const org = l.project.organization.name;
    await send([l.practitioner.user], (t, locale) => ({
      subject: t("Honoraires acceptés : {titre}", { titre: l.project.title }),
      text: [
        t("Bonjour,"),
        t("{org} accepte vos honoraires pour « {titre} » : {montant} HT.", { org, titre: l.project.title, montant: l.previousFeeCents != null ? `${fmtEur(locale, l.previousFeeCents)} → ${fmtEur(locale, l.feeCents!)}` : fmtEur(locale, l.feeCents!) }),
        t("Vous êtes engagé sur ce dossier : l'organisation le soumet à la conformité, puis la convention vous sera soumise."),
      ].join("\n\n"),
      cta: { label: t("Voir la sollicitation"), href: `/sollicitations/${l.id}` },
    }));
  });
}

/** Projet proposé par un expert (une copie par organisation : rien n'indique les autres destinataires). */
export function notifyProposal(projectId: string) {
  later(async () => {
    const p = await db.project.findUnique({ where: { id: projectId }, include: { experts: { include: { practitioner: linkInclude.practitioner } } } });
    const e = p?.experts[0];
    if (!p || !e) return;
    const type = collabType(p.typeId)?.label;
    await send(await members(p.organizationId, SOURCING_ROLES), (t, locale) => ({ subject: t("Projet proposé par {expert} : {title}", { expert: expertName(e.practitioner), title: p.title }), text: [t("Bonjour,"), t("{expert} propose un projet à votre organisation : « {title} »{v}{v2}.", { expert: expertName(e.practitioner), title: p.title, v: type ? ` (${type.toLowerCase()})` : "", v2: e.feeCents != null ? t(", honoraires souhaités : {montant} HT", { montant: fmtEur(locale, e.feeCents) }) : "" }), t("Acceptez-le pour ouvrir le circuit habituel (conformité, convention, signature), ou déclinez-le : l'expert est prévenu de votre réponse.")].join("\n\n"), cta: { label: t("Voir la proposition"), href: `/organisations/${p.organizationId}/dossiers/${p.id}` } }));
  });
}

/** Proposition retirée par l'expert avant la réponse de l'organisation. */
export function notifyProposalWithdrawnByExpert(projectId: string) {
  later(async () => {
    const p = await db.project.findUnique({ where: { id: projectId }, include: { experts: { include: { practitioner: linkInclude.practitioner } } } });
    const e = p?.experts[0];
    if (!p || !e) return;
    await send(await members(p.organizationId, SOURCING_ROLES), (t) => ({ subject: t("Proposition retirée : {title}", { title: p.title }), text: t("Bonjour,\n\n{expert} a retiré sa proposition « {title} ». Le dossier est clos, il n'y a rien d'autre à faire.", { expert: expertName(e.practitioner), title: p.title }), cta: { label: t("Voir le dossier"), href: `/organisations/${p.organizationId}/dossiers/${p.id}` } }));
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
    await send(creator ? [creator] : team, (t) => ({ subject: t("Nouvelle candidature : {title}", { title: call.title }), text: t("Bonjour,\n\n{expert} a candidaté à votre opportunité « {title} ».", { expert: expertName(prac), title: call.title }), cta: { label: t("Voir la candidature"), href: `/organisations/${call.organizationId}/opportunites/${call.id}` } }));
  });
}

/** Candidature envoyée : confirmation au praticien (e-mail de service), avec son message et la suite. */
export function notifyApplicationSent(applicationId: string) {
  later(async () => {
    const a = await db.application.findUnique({
      where: { id: applicationId },
      include: { openCall: { include: { organization: { select: { name: true } } } }, practitioner: { include: { user: { select: { ...userSelect, firstName: true } } } } },
    });
    if (!a) return;
    const call = a.openCall;
    const message = a.message ?? "";
    const excerpt = message.length > 600 ? `${message.slice(0, 600).trimEnd()}…` : message;
    await sendService([a.practitioner.user], (t) => ({
      subject: t("Candidature envoyée : {titre}", { titre: call.title }),
      text: [
        t("Bonjour {name},", { name: a.practitioner.user.firstName }),
        t("Votre candidature à « {titre} » ({org}) est transmise.", { titre: call.title, org: call.organization.name }),
        excerpt ? `${t("Votre message")} :\n${excerpt}` : null,
        t("Vous recevrez un e-mail dès que l'organisation aura répondu. Tant qu'elle ne l'a pas fait, vous pouvez retirer votre candidature depuis « Mes candidatures »."),
      ].filter(Boolean).join("\n\n"),
      cta: { label: t("Voir ma candidature"), href: `/opportunites/${call.id}` },
    }));
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
    await send(await projectTeam(l.project), (t, locale) => ({ subject: t("Note d'honoraires {number} de {expert}", { number: n.number, expert: expertName(l.practitioner) }), text: t("Bonjour,\n\n{expert} a établi sa note d'honoraires pour « {project} » : {montant} ({v}).\n\nElle est disponible dans le dossier ; indiquez le paiement une fois le virement fait.", { expert: expertName(l.practitioner), project: l.project.title, montant: fmtEur(locale, n.totalCents), v: n.vatBp ? "TTC" : t("TVA non applicable") }), cta: { label: t("Ouvrir le dossier"), href: `/organisations/${l.project.organizationId}/dossiers/${l.projectId}` } }));
  });
}

/** Erreur signalée par un praticien sur une déclaration Transparence Santé : l'équipe conformité est prévenue. */
export function notifyTransparencyIssue(orgId: string, who: string, label: string, comment: string) {
  later(async () => {
    await send(await members(orgId, COMPLIANCE_ROLES), (t) => ({ subject: t("Transparence Santé : erreur signalée par {who}", { who }), text: t("Bonjour,\n\n{who} signale une erreur sur : {label}.\n\n« {comment} »\n\nVérifiez la déclaration avant publication (ou corrigez-la sur la plateforme Transparence Santé).", { who, label, comment }), cta: { label: t("Ouvrir l'espace conformité"), href: `/organisations/${orgId}/conformite?onglet=transparence` } }));
  });
}

/** Nouvel avis vérifié : le prestataire est prévenu. */
export function notifySupplierReview(reviewId: string) {
  later(async () => {
    const r = await db.supplierReview.findUnique({ where: { id: reviewId }, include: { client: { select: { name: true } } } });
    if (!r) return;
    await send(await supplierTeam(r.supplierId), (t) => ({ subject: t("Nouvel avis {de_org} : {rating}/5", { de_org: de(r.client.name), rating: r.rating }), text: t("Bonjour,\n\n{client} a évalué votre prestation : {rating}/5.{v}", { client: r.client.name, rating: r.rating, v: r.comment ? `\n\n« ${r.comment} »` : "" }), cta: { label: t("Voir ma page publique"), href: `/structures/${r.supplierId}` } }));
  });
}

/** Circuit de conformité : dossier soumis (→ conformité), validé ou bloqué (→ équipe projet). */
export function notifyCompliance(projectId: string, step: "submit" | "validate" | "block", actorId: string) {
  later(async () => {
    const p = await db.project.findUnique({ where: { id: projectId } });
    if (!p) return;
    const href = `/organisations/${p.organizationId}/dossiers/${p.id}`;
    if (step === "submit") {
      await send(await members(p.organizationId, COMPLIANCE_ROLES), (t) => ({ subject: t("Dossier à valider : {title}", { title: p.title }), text: t("Bonjour,\n\nLe dossier « {title} » est soumis à la conformité.", { title: p.title }), cta: { label: t("Examiner le dossier"), href } }), actorId);
    } else {
      await send(await projectTeam(p), (t) => ({ subject: t("Dossier {v} par la conformité : {title}", { v: step === "validate" ? t("validé") : t("bloqué"), title: p.title }), text: t("Bonjour,\n\nLe dossier « {title} » est désormais : {v}.{v2}", { title: p.title, v: STATUS_LABEL[p.status], v2: p.complianceNote ? t("\n\nCommentaire : {complianceNote}", { complianceNote: p.complianceNote }) : "" }), cta: { label: t("Ouvrir le dossier"), href } }), actorId);
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
      await send(team.map((m) => m.user), (t) => ({ subject: t("Demande de devis {de_org}", { de_org: de(r.organization.name) }), text: t("Bonjour,\n\n{organization} vous consulte pour une prestation.{v}", { organization: r.organization.name, v: r.deadline ? t(" Réponse attendue avant le {date}.", { date: r.deadline.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) }) : "" }), cta: { label: t("Répondre à la demande"), href: `/organisations/${s.supplierId}/devis` } }));
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
    await send(await rfqContacts(r), (t) => ({ subject: revised ? t("Devis révisé par {name}", { name: supplier.name }) : t("Devis reçu {de_org}", { de_org: de(supplier.name) }), text: revised ? t("Bonjour,\n\n{name} a révisé son devis.", { name: supplier.name }) : t("Bonjour,\n\n{name} a répondu à votre demande de devis.", { name: supplier.name }), cta: { label: t("Comparer les devis"), href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` } }));
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

/** L'agence de l'événement est-elle elle-même consultée sur la demande (conflit d'intérêts) ? */
const agencyConsulted = async (rfqId: string, agencyId: string) => (await db.rfqSupplier.count({ where: { rfqId, supplierId: agencyId } })) > 0;

/**
 * Interlocuteurs d'une demande de devis côté client. L'appartenance d'une agence vient de son mandat (pas d'une
 * adhésion) : son équipe est prévenue pour les événements qui lui sont confiés, sauf quand elle est elle-même
 * consultée sur la demande (elle ne voit ni les devis ni les questions de ses concurrents).
 * Côté organisation : l'auteur de la demande s'il en est membre ; sinon les organisateurs, sauf si l'agence qui l'a
 * créée peut retenir les devis (sans ce droit, ce sont eux qui décident).
 */
async function rfqContacts(rfq: { id: string; organizationId: string; createdById: string | null; event: { organizationId: string; agencyId: string | null } | null }) {
  const [organizers, agency] = await Promise.all([members(rfq.organizationId, EVENT_ORGANIZER_ROLES), eventAgency(rfq.event)]);
  const conflicted = !!agency && (await agencyConsulted(rfq.id, agency.id));
  const agencyTeam = agency && !conflicted ? agency.team : [];
  const internal = organizers.find((u) => u.id === rfq.createdById);
  const byAgency = !!agency?.team.some((u) => u.id === rfq.createdById);
  return [...agencyTeam, ...(internal ? [internal] : byAgency && agency!.canAward && !conflicted ? [] : organizers)];
}

/** Événement confié à une agence : son équipe est prévenue et y accède aussitôt. */
export function notifyEventConfided(eventId: string) {
  later(async () => {
    const e = await db.event.findUnique({ where: { id: eventId }, include: { organization: { select: { name: true } } } });
    if (!e?.agencyId) return;
    await send(await supplierTeam(e.agencyId), (t) => ({ subject: t("{organization} vous confie « {title} »", { organization: e.organization.name, title: e.title }), text: t("Bonjour,\n\n{organization} confie à votre agence l'organisation de l'événement « {title} » ({date}). Vous y accédez avec votre compte KolBase : inscrits, prestataires et devis.", { organization: e.organization.name, title: e.title, date: e.startsAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) }), cta: { label: t("Ouvrir l'événement"), href: `/organisations/${e.organizationId}/evenements/${e.id}` } }));
  });
}

/** Événement retiré à une agence (confié à une autre, ou repris par l'organisation) : l'agence est prévenue. */
export function notifyEventWithdrawn(eventId: string, agencyId: string) {
  later(async () => {
    const e = await db.event.findUnique({ where: { id: eventId }, include: { organization: { select: { name: true } }, agency: { select: { name: true } } } });
    if (!e || e.agencyId === agencyId) return;
    await send(await supplierTeam(agencyId), (t) => ({ subject: t("« {title} » n'est plus confié à votre agence", { title: e.title }), text: t("Bonjour,\n\n{organization} {v} « {title} ». Votre équipe n'y a plus accès ; vos devis et échanges en tant que prestataire restent dans vos demandes de devis.", { organization: e.organization.name, v: e.agencyId ? t("a confié l'événement à une autre agence") : t("reprend l'organisation de l'événement"), title: e.title }), cta: { label: t("Voir mes demandes de devis"), href: `/organisations/${agencyId}/devis?onglet=toutes` } }));
  });
}

/** Fin de mandat : l'agence perd l'accès aux événements que l'organisation lui avait confiés. */
export function notifyMandateEnded(mandateId: string, eventTitles: string[]) {
  later(async () => {
    const m = await db.mandate.findUnique({ where: { id: mandateId }, include: { mandator: { select: { name: true } } } });
    if (!m) return;
    const list = eventTitles.length ? `\n\nÉvénements concernés : ${eventTitles.map((x) => `« ${x} »`).join(", ")}.` : "";
    await send(await supplierTeam(m.agencyId), (t) => ({ subject: t("Fin du mandat {de_org}", { de_org: de(m.mandator.name) }), text: t("Bonjour,\n\n{mandator} a mis fin au mandat de votre agence. Votre équipe n'accède plus à son espace ni aux événements qu'elle vous avait confiés.{list}", { mandator: m.mandator.name, list }), cta: { label: t("Voir mes demandes de devis"), href: `/organisations/${m.agencyId}/devis?onglet=toutes` } }));
  });
}

/** Résumé d'un devis : prestataire, montants HT et TTC. */
const quoteSummary = (q: { amountCents: number; vatBp: number; ttcCents: number | null; supplier: { name: string } }) =>
  `${q.supplier.name} : ${formatEUR(q.amountCents)} HT (${formatEUR(quoteTtc(q))} TTC)`;

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
      await send(await supplierTeam(q.supplierId), (t) => ({ subject: kept ? t("Votre devis est retenu par {organization}", { organization: r.organization.name }) : t("Votre devis n'est pas retenu par {organization}", { organization: r.organization.name }), text: kept ? t("Bonjour,\n\n{organization} a retenu votre devis {what}. Vous pouvez échanger avec l'organisation depuis la demande pour préparer la prestation.", { organization: r.organization.name, what }) : t("Bonjour,\n\n{organization} a retenu une autre offre {what}. Merci pour votre proposition.", { organization: r.organization.name, what }), cta: { label: t("Voir la demande"), href: `/organisations/${q.supplierId}/devis?onglet=toutes` } }));
    }
    const kept = r.quotes.find((q) => q.status === "retained");
    const agency = await eventAgency(r.event);
    if (!kept || !actorId || !agency) return;
    const href = `/organisations/${r.organizationId}/prestataires#rfq-${r.id}`;
    const others = r.quotes.length - 1;
    const rest = others > 0 ? ` ${others} autre${others > 1 ? "s" : ""} devis ${others > 1 ? "sont écartés" : "est écarté"}.` : "";
    if (agency.team.some((u) => u.id === actorId)) {
      await send(await members(r.organizationId, EVENT_ORGANIZER_ROLES), (t) => ({ subject: `${agency.name} a retenu un devis ${what}`.trim(), text: t("Bonjour,\n\n{name}, agence mandatée, a retenu en votre nom le devis {de_org}.{rest}\n\nVous pouvez retirer ce droit à l'agence dans Prestataires › Agences mandatées.", { name: agency.name, de_org: de(quoteSummary(kept)), rest }), cta: { label: t("Voir la demande"), href } }), actorId);
    } else if (!(await agencyConsulted(r.id, agency.id))) {
      // Agence consultée sur la demande : elle a reçu, comme prestataire, la décision sur son devis, sans le montant retenu.
      await send(agency.team, (t) => ({ subject: `${r.organization.name} a retenu un devis ${what}`.trim(), text: t("Bonjour,\n\n{organization} a retenu le devis {de_org}.{rest}", { organization: r.organization.name, de_org: de(quoteSummary(kept)), rest }), cta: { label: t("Voir la demande"), href } }), actorId);
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
    await send(await members(r.organizationId, EVENT_ORGANIZER_ROLES), (t) => ({ subject: t("Devis à retenir : {name} propose {supplier}", { name: agency.name, supplier: q.supplier.name }), text: t("Bonjour,\n\n{name}, agence mandatée{v}, vous propose de retenir le devis {de_org}. La décision vous revient : retenez ce devis ou un autre depuis la demande.", { name: agency.name, v: r.event ? t(" pour « {event} »", { event: r.event.title }) : "", de_org: de(quoteSummary(q)) }), cta: { label: t("Décider"), href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` } }), actorId);
  });
}

/**
 * Demande annulée : les prestataires consultés ne travaillent plus dessus. Annulée par l'auteur de la demande
 * (une agence mandatée, par exemple) : les organisateurs sont prévenus, avec le nom de qui a annulé.
 */
export function notifyRfqCancelled(rfqId: string, actorId: string) {
  later(async () => {
    const r = await db.rfq.findUnique({ where: { id: rfqId }, include: { organization: { select: { name: true } }, event: { select: { title: true } }, suppliers: true } });
    if (!r) return;
    // Brouillon jamais envoyé : les prestataires n'en ont pas eu connaissance.
    for (const s of r.sentAt ? r.suppliers : []) {
      if (s.declined) continue;
      await send(await supplierTeam(s.supplierId), (t) => ({ subject: t("Demande de devis annulée par {organization}", { organization: r.organization.name }), text: t("Bonjour,\n\n{organization} a annulé sa demande de devis{v}. Aucune réponse n'est plus attendue.", { organization: r.organization.name, v: r.event ? t(" pour « {event} »", { event: r.event.title }) : "" }), cta: { label: t("Voir mes demandes"), href: `/organisations/${s.supplierId}/devis?onglet=toutes` } }));
    }
    const organizers = await members(r.organizationId, EVENT_ORGANIZER_ROLES);
    if (organizers.some((u) => u.id === actorId)) return;
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, memberships: { where: { organization: { kind: "PRESTATAIRE" } }, select: { organization: { select: { name: true } } } } } });
    const who = actor ? `${actor.firstName} ${actor.lastName}${actor.memberships[0] ? ` (${actor.memberships[0].organization.name})` : ""}` : "L'auteur de la demande";
    await send(organizers, (t) => ({ subject: t("Demande de devis annulée{v}", { v: r.event ? ` : ${r.event.title}` : "" }), text: t("Bonjour,\n\n{who} a annulé la demande de devis{v} ({supplierCategoryLabel}). Les prestataires consultés sont prévenus.", { who, v: r.event ? t(" pour « {event} »", { event: r.event.title }) : "", supplierCategoryLabel: supplierCategoryLabel(r.category) }), cta: { label: t("Voir la demande"), href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` } }), actorId);
  });
}

/** Devis révisé par le prestataire alors que l'agence l'avait proposé : la proposition tombe, l'agence est prévenue. */
export function notifyProposalWithdrawn(rfqId: string, supplierId: string, proposerId: string) {
  later(async () => {
    const [r, supplier, proposer] = await Promise.all([
      db.rfq.findUnique({ where: { id: rfqId }, include: { event: { select: { title: true } } } }),
      db.organization.findUnique({ where: { id: supplierId }, select: { name: true } }),
      db.user.findUnique({ where: { id: proposerId }, select: userSelect }),
    ]);
    if (!r || !supplier || !proposer) return;
    await send([proposer], (t) => ({ subject: t("Devis proposé révisé : {name}{v}", { name: supplier.name, v: r.event ? ` (${r.event.title})` : "" }), text: t("Bonjour,\n\n{name} a révisé le devis que vous aviez proposé à l'organisation{v}. Votre proposition portait sur l'ancienne version : elle est retirée. Relisez la nouvelle version et proposez-la de nouveau si elle vous convient.", { name: supplier.name, v: r.event ? t(" pour « {event} »", { event: r.event.title }) : "" }), cta: { label: t("Voir la demande"), href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` } }));
  });
}

/** Un prestataire décline une demande : les interlocuteurs de la demande sont prévenus, avec le motif s'il en donne un. */
export function notifyRfqDeclined(rfqId: string, supplierId: string, actorId: string) {
  later(async () => {
    const [r, invite] = await Promise.all([
      db.rfq.findUnique({ where: { id: rfqId }, include: { event: { select: { title: true, organizationId: true, agencyId: true } } } }),
      db.rfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } }, include: { supplier: { select: { name: true } } } }),
    ]);
    if (!r || !invite) return;
    const name = invite.supplier.name;
    await send(await rfqContacts(r), (t) => ({ subject: t("{name} décline votre demande de devis{v}", { name, v: r.event ? ` (${r.event.title})` : "" }), text: t("Bonjour,\n\n{name} ne répondra pas à votre demande de devis{v} ({supplierCategoryLabel}).{v2}", { name, v: r.event ? t(" pour « {event} »", { event: r.event.title }) : "", supplierCategoryLabel: supplierCategoryLabel(r.category), v2: invite.declineNote ? t("\n\nMotif : {declineNote}", { declineNote: invite.declineNote }) : "" }), cta: { label: t("Voir la demande"), href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` } }), actorId);
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
      await send(await rfqContacts(r), (t) => ({ subject: t("Question {de_org} sur votre demande de devis", { de_org: de(supplier.name) }), text: t("Bonjour,\n\n{name} vous a écrit au sujet de votre demande de devis.", { name: supplier.name }), cta: { label: t("Répondre"), href: `/organisations/${r.organizationId}/prestataires#rfq-${r.id}` } }), authorId);
    } else {
      await send(await supplierTeam(supplierId), (t) => ({ subject: t("Message {de_org} sur une demande de devis", { de_org: de(r.organization.name) }), text: t("Bonjour,\n\n{organization} vous a écrit au sujet de sa demande de devis.", { organization: r.organization.name }), cta: { label: t("Répondre"), href: `/organisations/${supplierId}/devis` } }), authorId);
    }
  });
}

// ─── E-mails de service (toujours envoyés) ─────────────────────────────────

/** Invitation à rejoindre une organisation, quand l'adresse est connue : le rôle proposé est annoncé. */
export function notifyInvitation(email: string, orgName: string, inviterName: string, link: string, role: string) {
  later(async () => {
    await sendMail({
      to: email,
      subject: `${inviterName} vous invite à rejoindre ${orgName} sur KolBase`,
      text: `Bonjour,\n\n${inviterName} vous invite à rejoindre l'espace ${de(orgName)} sur KolBase, avec le rôle « ${role} ».\n\nL'invitation est réservée à cette adresse e-mail : créez votre compte ou connectez-vous avec elle. Le lien est valable 14 jours et ne sert qu'une fois.`,
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

/**
 * Validation, refus, suspension ou réactivation d'une organisation : ses administrateurs sont prévenus (motif compris).
 * `billing` : ce qui a été fait de la facturation Stripe (mise en pause à la suspension, reprise à la réactivation).
 */
export function notifyOrgDecision(orgId: string, decision: "verify" | "reject" | "suspend" | "reactivate", note: string | null, billing: "paused" | "resumed" | null = null) {
  later(async () => {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true, kind: true, listed: true } });
    if (!org) return;
    const supplier = org.kind === "PRESTATAIRE";
    const mail = (t: T, locale: Locale) => {
      const motif = note ? `\n\n${t("Motif : {note}", { note })}` : "";
      // Prochaines étapes annoncées à la validation : contrat de sous-traitance et abonnement (organisation), abonnement
      // après le premier devis retenu (prestataire).
      const next = supplier
        ? t("Le référencement est gratuit ; l'abonnement prestataire ({prix} HT par mois) n'est demandé qu'après votre premier devis retenu.", { prix: fmtEur(locale, PLANS.prestataire.cents) })
        : t("Avant votre première action qui engage un tiers (sollicitation, publication, demande de devis), un administrateur accepte le contrat de sous-traitance (données personnelles), puis active l'abonnement ({prix} HT par mois, premier mois offert) : KolBase vous y guide au moment voulu.", { prix: fmtEur(locale, PLANS.organisation.cents) });
      // Identité à corriger : SIREN, ou RNA pour une association ou une société savante (SIREN facultatif).
      const identity = t(rnaAccepted(org.kind) ? "SIREN ou RNA, nom" : "SIREN, nom");
      return decision === "verify" ? { subject: t("{name} est validée sur KolBase", { name: org.name }), text: t("Bonjour,\n\nL'équipe KolBase a validé {name}.{v}\n\n{v2}\n\n{next}", { name: org.name, v: note ? t("\n\nNote de l'équipe KolBase : {note}", { note }) : "", v2: supplier ? t("Vous pouvez répondre aux demandes de devis des organisations{v}.", { v: org.listed ? t(" ; votre fiche figure dans l'annuaire des prestataires") : t(" et vous référencer dans l'annuaire des prestataires (catégories de prestation) depuis la page Devis") }) : t("Vous pouvez désormais solliciter des experts, publier vos événements et vos opportunités, et consulter des prestataires. Votre page publique est en ligne ; vous pouvez la retirer de l'annuaire dans Membres et réglages."), next }), cta: { label: supplier ? t("Ouvrir mes demandes de devis") : t("Ouvrir l'espace de l'organisation"), href: supplier ? `/organisations/${orgId}/devis` : `/organisations/${orgId}` } } : decision === "reject" ? { subject: t("{name} n'a pas été validée sur KolBase", { name: org.name }), text: t("Bonjour,\n\nL'équipe KolBase n'a pas pu valider {name}.{motif}\n\nCorrigez l'identité de l'organisation ({identity}) dans Membres et réglages : la demande sera examinée de nouveau. Pour toute question, répondez à cet e-mail.", { name: org.name, motif, identity }), cta: { label: t("Corriger l'identité de l'organisation"), href: `/organisations/${orgId}/membres?onglet=organisation` } } : decision === "suspend" ? { subject: t("{name} est suspendue sur KolBase", { name: org.name }), text: t("Bonjour,\n\nL'équipe KolBase a suspendu {name}.{motif}\n\nPendant la suspension, votre page publique, vos événements et vos opportunités sont masqués, et l'organisation ne peut plus solliciter d'experts, publier ni envoyer de demandes de devis. Rien n'est supprimé : tout réapparaît tel quel à la réactivation.{v} Pour en discuter, répondez à cet e-mail.", { name: org.name, motif, v: billing === "paused" ? t(" La facturation de votre abonnement est mise en pause : rien n'est facturé pendant la suspension.") : "" }), cta: { label: t("Voir l'organisation"), href: `/organisations/${orgId}` } } : { subject: t("{name} est de nouveau active sur KolBase", { name: org.name }), text: t("Bonjour,\n\nL'équipe KolBase a levé la suspension {de_org}. {v}{v2}", { de_org: de(org.name), v: supplier ? t("Votre fiche prestataire est de nouveau visible et vous pouvez répondre aux demandes de devis.") : t("Votre page publique, vos événements et vos opportunités sont de nouveau visibles ; vous pouvez de nouveau solliciter des experts, publier et consulter des prestataires."), v2: billing === "resumed" ? t(" La facturation de votre abonnement reprend.") : billing === "paused" ? t(" Votre abonnement reste offert jusqu'à la fin de la gratuité en cours ; la facturation reprendra ensuite.") : "" }), cta: { label: t("Ouvrir l'espace de l'organisation"), href: `/organisations/${orgId}` } };
    };
    await sendService(await members(orgId, ["ADMIN"]), mail);
  });
}

/** Identité professionnelle d'un praticien vérifiée ou refusée (motif et consigne). */
/** Photo retirée par l'équipe KolBase (motif facultatif). */
export function notifyPhotoRemoved(practitionerId: string, note: string | null) {
  later(async () => {
    const p = await db.practitionerProfile.findUnique({ where: { id: practitionerId }, include: { user: { select: userSelect } } });
    if (!p) return;
    await sendService([p.user], (t) => ({
      subject: t("Votre photo a été retirée de KolBase"),
      text: [
        t("Bonjour,"),
        t("L'équipe KolBase a retiré la photo de votre profil : elle ne correspond pas à ce qu'attendent les organisations (un portrait de vous, net et de face)."),
        note ? t("Motif : {note}", { note }) : null,
        t("Vous pouvez en ajouter une autre depuis « Mon compte › Photo »."),
      ].filter(Boolean).join("\n\n"),
      cta: { label: t("Ajouter une photo"), href: "/compte#photo" },
    }));
  });
}

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
export function notifyExemption(orgId: string, until: Date | null, note: string | null, stripeBilling: "paused" | "resumed" | null = null) {
  later(async () => {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true, kind: true } });
    if (!org) return;
    const actions = org.kind === "PRESTATAIRE" ? "répondre aux demandes de devis" : "solliciter des experts, publier vos événements et vos opportunités, envoyer des demandes de devis";
    const dateIn = (locale: Locale) => until?.toLocaleDateString(intlLocale(locale), { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
    await sendService(await members(orgId, ["ADMIN"]), (t, locale) => (until ? { subject: t("KolBase vous offre l'abonnement jusqu'au {date}", { date: dateIn(locale) }), text: t("Bonjour,\n\nL'équipe KolBase offre l'abonnement {de_org} jusqu'au {date} inclus{v}. D'ici là, vous pouvez {actions} sans rien payer.{v2}", { de_org: de(org.name), date: dateIn(locale), v: note ? ` (${note})` : "", actions: t(actions), v2: stripeBilling === "paused" ? t(" La facturation de votre abonnement en cours est suspendue pendant cette période ; elle reprendra d'elle-même ensuite.") : "" }), cta: { label: t("Voir l'abonnement"), href: `/organisations/${orgId}/abonnement` } } : { subject: t("KolBase : gratuité de l'abonnement retirée"), text: stripeBilling === "resumed" ? t("Bonjour,\n\nL'abonnement {de_org} n'est plus offert par l'équipe KolBase : la facturation de votre abonnement en cours reprend. Rien ne change pour vos fonctions, dossiers, événements et échanges.", { de_org: de(org.name) }) : t("Bonjour,\n\nL'abonnement {de_org} n'est plus offert par l'équipe KolBase. Pour continuer à {actions}, un administrateur active l'abonnement depuis la page Abonnement. Vos dossiers, événements et échanges restent accessibles.", { de_org: de(org.name), actions: t(actions) }), cta: { label: t("Voir l'abonnement"), href: `/organisations/${orgId}/abonnement` } }));
  });
}

// ─── Avant et après l'événement (tâche planifiée ou envoi par l'organisateur) ───

/** Rappel aux inscrits pas encore prévenus : date, lieu, programme, badge d'accueil. Renvoie le nombre d'inscriptions traitées. */
export async function sendEventReminders(eventId: string, now = new Date()) {
  const ev = await db.event.findUnique({
    where: { id: eventId },
    include: { organization: { select: { name: true } }, registrations: { where: { reminderSentAt: null }, include: { user: { select: { ...userSelect, firstName: true } } } } },
  });
  if (!ev || ev.internal || ev.cancelledAt || ev.startsAt <= now) return 0;
  const inPerson = ev.format !== "DISTANCIEL";
  const program = ev.program ? (ev.program.length > 700 ? `${ev.program.slice(0, 700).trimEnd()}…` : ev.program) : null;
  for (const r of ev.registrations) {
    await sendOnce(
      () => db.registration.updateMany({ where: { id: r.id, reminderSentAt: null }, data: { reminderSentAt: now } }),
      () => db.registration.update({ where: { id: r.id }, data: { reminderSentAt: null } }),
      () => send([r.user], (t, locale) => {
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
      }),
    );
  }
  return ev.registrations.length;
}

/** Date et heure d'un événement dans la langue du destinataire (heure de Paris). */
const eventWhen = (d: Date, locale: Locale) =>
  d.toLocaleString(locale === "en" ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Inscription confirmée (e-mail de service, envoyé quelle que soit la préférence de notifications) : date, lieu ou
 * lien de connexion, prestations acceptées, badge d'accueil et invitation d'agenda (.ics) jointe.
 */
export function notifyRegistration(registrationId: string) {
  later(async () => {
    const r = await db.registration.findUnique({
      where: { id: registrationId },
      include: { user: { select: { ...userSelect, firstName: true } }, benefits: { include: { benefit: true } }, event: { include: { organization: { select: { name: true } } } } },
    });
    if (!r) return;
    const ev = r.event;
    const inPerson = ev.format !== "DISTANCIEL";
    await sendService([r.user], (t, locale) => {
      const total = r.benefits.reduce((sum, b) => sum + b.valueCents, 0);
      return {
        subject: t("Inscription confirmée : « {title} »", { title: ev.title }),
        text: [
          t("Bonjour {name},", { name: r.user.firstName }),
          t("Votre inscription à « {title} » ({org}) est confirmée.", { title: ev.title, org: ev.organization.name }),
          [
            t("Date : {when}", { when: eventWhen(ev.startsAt, locale) }),
            inPerson ? t("Lieu : {place}", { place: [ev.venue, ev.city].filter(Boolean).join(", ") || t("à préciser par l'organisateur") }) : null,
            // Lien de connexion (en ligne, hybride) : réservé aux inscrits.
            ev.format === "PRESENTIEL" ? null : ev.onlineUrl ? t("Lien de connexion : {url}", { url: ev.onlineUrl }) : t("En ligne : le lien de connexion vous est communiqué par l'organisateur."),
          ].filter(Boolean).join("\n"),
          r.benefits.length > 0
            ? t("Prestations acceptées : {list} ({total}).", { list: r.benefits.map((b) => t(b.benefit.label)).join(", "), total: fmtEur(locale, total) })
            : null,
          inPerson ? t("À l'accueil, présentez votre badge : le lien ci-dessous l'affiche sur votre téléphone.") : null,
          t("L'événement est joint à cet e-mail pour votre agenda (fichier .ics)."),
          t("Un empêchement ? Annulez votre inscription depuis « Mes inscriptions » : {url}", { url: `${appUrl()}/inscriptions` }),
        ].filter(Boolean).join("\n\n"),
        cta: inPerson ? { label: t("Mon badge d'accueil"), href: `/inscriptions/${r.id}/badge` } : { label: t("Voir l'événement"), href: `/evenements/${ev.id}` },
        attachments: [{ filename: "evenement.ics", contentType: "text/calendar; charset=utf-8; method=PUBLISH", content: toIcs(ev.title, [eventIcsEntry(ev, ev.organization.name, true, t)]) }],
      };
    });
  });
}

/** Inscription annulée par la personne inscrite (e-mail de service). */
export function notifyRegistrationCancelled(userId: string, eventId: string, benefits: number) {
  later(async () => {
    const [u, ev] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { ...userSelect, firstName: true } }),
      db.event.findUnique({ where: { id: eventId }, include: { organization: { select: { name: true } } } }),
    ]);
    if (!u || !ev) return;
    await sendService([u], (t, locale) => ({
      subject: t("Inscription annulée : « {title} »", { title: ev.title }),
      text: [
        t("Bonjour {name},", { name: u.firstName }),
        t("Votre inscription à « {title} » ({org}), {when}, est annulée.", { title: ev.title, org: ev.organization.name, when: eventWhen(ev.startsAt, locale) }),
        benefits > 0 ? t("Les prestations que vous aviez acceptées sont retirées.") : null,
        t("Vous pouvez vous réinscrire tant que les inscriptions sont ouvertes."),
      ].filter(Boolean).join("\n\n"),
      cta: { label: t("Voir l'événement"), href: `/evenements/${ev.id}` },
    }));
  });
}

/** Événement annulé par l'organisation (e-mail de service) : chaque inscrit est prévenu, avec le motif. */
export function notifyEventCancelled(eventId: string) {
  later(async () => {
    const ev = await db.event.findUnique({
      where: { id: eventId },
      include: { organization: { select: { name: true } }, registrations: { where: { cancelledAt: { not: null } }, include: { user: { select: { ...userSelect, firstName: true } } } } },
    });
    if (!ev?.cancelledAt) return;
    for (const r of ev.registrations) {
      await sendService([r.user], (t, locale) => ({
        subject: t("Événement annulé : « {title} »", { title: ev.title }),
        text: [
          t("Bonjour {name},", { name: r.user.firstName }),
          t("{org} annule « {title} », prévu {when}, auquel vous étiez inscrit.", { org: ev.organization.name, title: ev.title, when: eventWhen(ev.startsAt, locale) }),
          ev.cancelReason ? t("Motif : {note}", { note: ev.cancelReason }) : null,
          t("Votre inscription est annulée, ainsi que les prestations d'hospitalité prévues. Vous n'avez rien à faire."),
        ].filter(Boolean).join("\n\n"),
        cta: { label: t("Voir l'événement"), href: `/evenements/${ev.id}` },
      }));
    }
  });
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
  if (!ev || ev.internal || ev.cancelledAt) return 0;
  const pointed = ev.registrations.some((r) => r.checkedInAt);
  const targets = ev.registrations.filter((r) => !r.followUpSentAt && (!pointed || r.checkedInAt));
  for (const r of targets) {
    await sendOnce(
      () => db.registration.updateMany({ where: { id: r.id, followUpSentAt: null }, data: { followUpSentAt: now } }),
      () => db.registration.update({ where: { id: r.id }, data: { followUpSentAt: null } }),
      () => send([r.user], (t) => ({
        subject: t("Merci pour votre participation à « {title} »", { title: ev.title }),
        text: [
          t("Bonjour {name},", { name: r.user.firstName }),
          t("Merci d'avoir participé à « {title} » ({org}).", { title: ev.title, org: ev.organization.name }),
          r.checkedInAt ? t("Votre attestation de présence est disponible dans « Mes inscriptions ».") : null,
          t("Votre avis aide l'organisateur à améliorer les prochaines éditions : une minute suffit, vos réponses lui sont transmises sans votre nom."),
        ].filter(Boolean).join("\n\n"),
        cta: { label: t("Donner mon avis"), href: `/evenements/${ev.id}/avis` },
      })),
    );
  }
  return targets.length;
}

// ─── Abonnement ──────────────────────────────────────────────────────────────

/** Premier devis retenu d'un prestataire : l'abonnement (premier mois offert) est à activer pour continuer. */
export function notifySupplierBilling(supplierId: string, client: string) {
  later(async () => {
    await send(await members(supplierId, ["ADMIN"]), (t) => ({ subject: t("Félicitations : {client} a retenu votre devis", { client }), text: t("Bonjour,\n\nVotre premier devis retenu via KolBase, bravo !\n\nLe référencement reste gratuit ; pour continuer à répondre à de nouvelles demandes, activez votre abonnement prestataire (249 € HT par mois, premier mois offert, sans engagement). La prestation retenue et vos échanges en cours ne sont pas concernés."), cta: { label: t("Activer mon abonnement"), href: `/organisations/${supplierId}/abonnement` } }));
  });
}

/** Échec de paiement signalé par Stripe : les administrateurs mettent à jour leur moyen de paiement. */
export function notifyPaymentFailed(orgId: string) {
  later(async () => {
    await send(await members(orgId, ["ADMIN"]), (t) => ({ subject: t("KolBase : le paiement de votre abonnement a échoué"), text: t("Bonjour,\n\nLe dernier prélèvement de votre abonnement KolBase n'a pas abouti. Stripe va réessayer ; pour éviter toute interruption, vérifiez votre moyen de paiement."), cta: { label: t("Gérer mon abonnement"), href: `/organisations/${orgId}/abonnement` } }));
  });
}

// ─── Services KolBase ────────────────────────────────────────────────────────

/** Suivi d'une commande de service : la personne qui l'a passée est prévenue (planifiée, refusée, réalisée). */
export function notifyServiceOrder(orderId: string) {
  later(async () => {
    const o = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { event: { select: { id: true, title: true, organizationId: true } }, offer: { select: { kind: true } } } });
    if (!o) return;
    const user = await db.user.findUnique({ where: { id: o.orderedById }, select: userSelect });
    if (!user) return;
    const until = featuredUntil(o);
    if (!["planifiee", "refusee", "realisee"].includes(o.status)) return;
    // Texte composé dans la langue du destinataire.
    const compose = (t: T, locale: Locale) => {
      const day = (d: Date) => d.toLocaleDateString(intlLocale(locale), { timeZone: "Europe/Paris", day: "numeric", month: "long" });
      const what = t("« {label} » pour « {event} »", { label: o.label, event: o.event.title });
      // « Prochaine facture » seulement si le montant est déjà inscrit sur la facture Stripe de l'abonnement.
      const amount = `${fmtEur(locale, o.priceCents)} ${t("HT")}${o.packLabel ? ` (${t("part du {pack}", { pack: o.packLabel })})` : ""}`;
      const billing = o.priceCents > 0 ? `\n\n${t(o.invoicedAt ? "Montant : {amount}, sur votre prochaine facture." : "Montant : {amount}, facture à venir.", { amount })}` : "";
      const feature = until ? `\n\n${t("L'événement est à la une de la page d'accueil de KolBase jusqu'au {date}.", { date: day(until) })}` : "";
      const text =
        o.status === "planifiee" ? `${o.plannedAt ? t("L'équipe KolBase a planifié {what} : réalisation prévue le {date}.", { what, date: day(o.plannedAt) }) : t("L'équipe KolBase a planifié {what}.", { what })}${o.adminNote ? `\n\n${o.adminNote}` : ""}`
        : o.status === "refusee" ? `${t("L'équipe KolBase ne peut pas réaliser {what}.", { what })}\n\n${o.adminNote ?? ""}`
        : `${t("L'équipe KolBase a réalisé {what}.", { what })}${feature}${o.resultUrl ? `\n\n${t("Résultat : {url}", { url: o.resultUrl })}` : ""}${o.adminNote ? `\n\n${o.adminNote}` : ""}${billing}`;
      return { subject: t("Service KolBase : {label}", { label: o.label }), text: `${t("Bonjour,")}\n\n${text}`, cta: { label: t("Voir l'événement"), href: `/organisations/${o.event.organizationId}/evenements/${o.event.id}` } };
    };
    await send([user], compose);
  });
}

/** Bilan d'un service réalisé, envoyé à la personne qui l'a commandé (et aux organisateurs si elle n'est plus membre). */
export async function sendServiceReport(orderId: string, now = new Date()) {
  const o = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { offer: { select: { kind: true } }, event: { select: { id: true, title: true, startsAt: true, organizationId: true } } } });
  if (!o || o.status !== "realisee" || o.reportSentAt || !o.doneAt) return false;
  const s = (await orderStats([o])).get(o.id)!;
  const rate = conversion(s);
  // Texte composé dans la langue du destinataire.
  const report = (t: T, locale: Locale) => {
    const done = o.doneAt!.toLocaleDateString(intlLocale(locale), { timeZone: "Europe/Paris", day: "numeric", month: "long" });
    return [
      t("Voici le bilan de « {label} » pour « {event} », réalisé le {date}.", { label: o.label, event: o.event.title, date: done }),
      "",
      ...reportParts(s, o.offer.kind).map((p) => `- ${t(p.key, { n: p.n.toLocaleString(intlLocale(locale)) })}`),
      ...(rate != null ? [`- ${t("{rate} % des visiteurs se sont inscrits", { rate })}`] : []),
      ...(s.since != null ? [`- ${t(s.since > 1 ? "{n} inscriptions à l'événement au total depuis le {date}" : "{n} inscription à l'événement au total depuis le {date}", { n: s.since, date: done })}`] : []),
      "",
      t("Les visiteurs sont comptés une fois (robots et aperçus de liens exclus) ; une inscription est attribuée au service quand elle suit un clic sur son lien dans les 30 jours."),
      ...(o.event.startsAt > now ? ["", t("Pour relancer avant l'événement, vous pouvez commander un nouveau service depuis la fiche de l'événement.")] : []),
    ].join("\n");
  };
  const orderer = await db.user.findUnique({ where: { id: o.orderedById }, select: { ...userSelect, memberships: { where: { organizationId: o.organizationId }, select: { id: true } } } });
  const to = orderer && orderer.memberships.length > 0 ? [orderer] : await members(o.organizationId, EVENT_ORGANIZER_ROLES);
  return sendOnce(
    () => db.serviceOrder.updateMany({ where: { id: o.id, reportSentAt: null }, data: { reportSentAt: now } }),
    () => db.serviceOrder.update({ where: { id: o.id }, data: { reportSentAt: null } }),
    () => send(to, (t, locale) => ({ subject: t("Bilan : {label} — {event}", { label: o.label, event: o.event.title }), text: `${t("Bonjour,")}\n\n${report(t, locale)}`, cta: { label: t("Voir l'événement"), href: `/organisations/${o.event.organizationId}/evenements/${o.event.id}#services` } })),
  );
}
