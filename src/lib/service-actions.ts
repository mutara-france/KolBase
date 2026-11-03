"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";
import { EVENT_ORGANIZER_ROLES, formatDate, formatTime } from "@/lib/events";
import { eurToCents, str } from "@/lib/form";
import { sendMail } from "@/lib/mail";
import { allocate } from "@/lib/service-pack";
import { invoiceOrder, newsletterAudience, newTrackCode, OPEN_ORDER, trackedPath, unsubscribeToken } from "@/lib/services";
import { notifyPlatformAdmins, notifyServiceOrder } from "@/lib/notifications";
import { aiComplete, aiEnabled } from "@/lib/ai";
import { blockedFor, hit } from "@/lib/rate-limit";

export type FormState = { error?: string; ok?: string } | undefined;
const app = () => process.env.APP_URL ?? "http://localhost:3000";
const refresh = (orgId: string, eventId: string) => {
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath("/admin");
  revalidatePath("/");
};

// ─── Organisation ───────────────────────────────────────────────────────────

/** Commande d'un service KolBase pour un événement publié et à venir. */
export async function orderService(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const event = await db.event.findFirst({ where: { id: str(form, "eventId"), organizationId: orgId } });
  if (!event) return { error: "Événement introuvable." };
  if (event.internal || !event.publishedAt) return { error: "Publiez d'abord l'événement dans l'agenda." };
  if (event.startsAt < new Date()) return { error: "L'événement est passé." };
  const offer = await db.serviceOffer.findFirst({ where: { id: str(form, "offerId"), active: true } });
  if (!offer) return { error: "Service indisponible." };
  // Pack : un service par élément compris, prix du pack réparti au prorata (facturé au fil des réalisations).
  const items = offer.kind === "pack" ? await db.serviceOffer.findMany({ where: { code: { in: offer.includes }, active: true, kind: { not: "pack" } }, orderBy: { position: "asc" } }) : [offer];
  if (items.length === 0 || (offer.kind === "pack" && items.length !== offer.includes.length)) return { error: "Service indisponible." };
  if (await db.serviceOrder.findFirst({ where: { eventId: event.id, offerId: { in: items.map((i) => i.id) }, status: { in: OPEN_ORDER } } }))
    return { error: offer.kind === "pack" ? "Un des services du pack est déjà commandé pour cet événement." : "Ce service est déjà commandé pour cet événement." };
  const wishedRaw = str(form, "wishedAt");
  const wishedAt = /^\d{4}-\d{2}-\d{2}$/.test(wishedRaw) ? new Date(`${wishedRaw}T09:00:00Z`) : null;
  if (wishedAt && (wishedAt < new Date(Date.now() - 86400e3) || wishedAt > event.startsAt)) return { error: "Date souhaitée : entre aujourd'hui et l'événement." };
  const prices = offer.kind === "pack" ? allocate(items.map((i) => i.priceCents), offer.priceCents) : [offer.priceCents];
  const brief = str(form, "brief").slice(0, 2000) || null;
  const orders = await db.$transaction(items.map((item, i) => db.serviceOrder.create({
    data: {
      organizationId: orgId, eventId: event.id, offerId: item.id, label: item.label, priceCents: prices[i], brief, wishedAt, orderedById: user.id,
      trackCode: newTrackCode(), packLabel: offer.kind === "pack" ? offer.label : null,
    },
  })));
  for (const o of orders) await audit(user.id, "service.order", "ServiceOrder", o.id, { offer: offer.code, priceCents: o.priceCents });
  notifyPlatformAdmins(`Service commandé : ${offer.label}`, `${user.firstName} ${user.lastName} commande « ${offer.label} » (${(offer.priceCents / 100).toLocaleString("fr-FR")} € HT) pour l'événement « ${event.title} » du ${formatDate(event.startsAt)}.${offer.kind === "pack" ? `\n\nServices compris : ${items.map((i) => i.label).join(", ")}.` : ""}`, "/admin?onglet=services");
  refresh(orgId, event.id);
  return { ok: "Commande transmise à l'équipe KolBase : vous serez prévenu de sa planification." };
}

/** Annulation d'une commande pas encore planifiée. */
export async function cancelServiceOrder(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const o = await db.serviceOrder.findFirst({ where: { id: str(form, "orderId"), organizationId: orgId, status: "demandee" } });
  if (!o) return;
  // Service d'un pack : le pack entier est annulé (le prix réduit n'a de sens qu'ensemble), s'il n'est pas commencé.
  const siblings = o.packLabel
    ? await db.serviceOrder.findMany({ where: { eventId: o.eventId, packLabel: o.packLabel, orderedById: o.orderedById, createdAt: { gte: new Date(o.createdAt.getTime() - 5000), lte: new Date(o.createdAt.getTime() + 5000) } }, select: { id: true, status: true } })
    : [{ id: o.id, status: o.status }];
  if (siblings.some((x) => x.status !== "demandee" && x.status !== "annulee")) return;
  await db.serviceOrder.updateMany({ where: { id: { in: siblings.map((x) => x.id) }, status: "demandee" }, data: { status: "annulee" } });
  await audit(user.id, "service.cancel", "ServiceOrder", o.id, { pack: o.packLabel ?? undefined });
  refresh(orgId, o.eventId);
}

// ─── Équipe KolBase ───────────────────────────────────────────────────────

/** Planification (date de réalisation), refus motivé ou réalisation (lien du résultat), avec facturation. */
export async function updateServiceOrder(form: FormData) {
  const admin = await requirePlatformAdmin();
  const o = await db.serviceOrder.findUnique({ where: { id: str(form, "orderId") } });
  if (!o) return;
  const action = str(form, "action");
  const note = str(form, "note").slice(0, 500) || null;
  if (action === "plan") {
    const d = str(form, "plannedAt");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !OPEN_ORDER.includes(o.status)) return;
    await db.serviceOrder.update({ where: { id: o.id }, data: { status: "planifiee", plannedAt: new Date(`${d}T09:00:00Z`), adminNote: note ?? o.adminNote } });
  } else if (action === "refuse") {
    if (!note || !OPEN_ORDER.includes(o.status)) return;
    await db.serviceOrder.update({ where: { id: o.id }, data: { status: "refusee", adminNote: note } });
  } else if (action === "done") {
    if (!OPEN_ORDER.includes(o.status)) return;
    const url = str(form, "resultUrl");
    await db.serviceOrder.update({ where: { id: o.id }, data: { status: "realisee", doneAt: new Date(), resultUrl: /^https?:\/\/\S+$/.test(url) ? url.slice(0, 500) : null, adminNote: note ?? o.adminNote } });
    await invoiceOrder(o.id).catch((e) => console.error("[facturation du service]", e));
  } else if (action === "invoiced") {
    await db.serviceOrder.update({ where: { id: o.id }, data: { invoicedAt: new Date(), invoiceRef: note ?? "facturé hors Stripe" } });
  } else return;
  await audit(admin.id, `service.${action}`, "ServiceOrder", o.id, { note: note ?? undefined });
  if (action !== "invoiced") notifyServiceOrder(o.id);
  refresh(o.organizationId, o.eventId);
}

/** Catalogue : création ou modification d'un service (libellé, description, prix HT, actif). */
export async function saveServiceOffer(form: FormData) {
  const admin = await requirePlatformAdmin();
  const id = str(form, "id");
  const price = eurToCents(str(form, "price"));
  const label = str(form, "label").slice(0, 120);
  const description = str(form, "description").slice(0, 600);
  const kind = ["newsletter", "social", "une", "autre"].includes(str(form, "kind")) ? str(form, "kind") : "autre";
  if (!label || price == null) return;
  const data = { label, description, priceCents: price, active: form.get("active") === "on", position: Number(str(form, "position")) || 0 };
  if (id) await db.serviceOffer.update({ where: { id }, data });
  else await db.serviceOffer.create({ data: { ...data, kind, code: `${kind}-${Date.now().toString(36)}` } });
  await audit(admin.id, id ? "service.offer_update" : "service.offer_create", "ServiceOffer", id || label);
  revalidatePath("/admin");
}

/** Lettre d'information : envoi aux membres consentants (désinscription en un clic), puis service réalisé et facturé. */
export async function sendNewsletter(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const subject = str(form, "subject").slice(0, 160);
  const body = str(form, "body").slice(0, 8000);
  if (!subject || body.length < 20) return { error: "Objet et texte sont obligatoires." };
  const orderId = str(form, "orderId") || null;
  const order = orderId ? await db.serviceOrder.findUnique({ where: { id: orderId }, include: { event: true, organization: { select: { name: true } } } }) : null;
  if (orderId && (!order || !OPEN_ORDER.includes(order.status))) return { error: "Commande introuvable ou déjà traitée." };
  if (order && (await db.newsletterCampaign.findUnique({ where: { orderId: order.id } }))?.sentAt) return { error: "Lettre déjà envoyée." };
  const audience = await newsletterAudience();
  if (audience.length === 0) return { error: "Aucun membre n'a accepté de recevoir la lettre d'information." };
  // Communication commerciale identifiée comme telle (annonceur nommé).
  const text = order ? `${body}\n\nCommunication de ${order.organization.name}, diffusée par KolBase.` : body;
  let sent = 0;
  for (const u of audience) {
    const token = await unsubscribeToken(u.id, u.unsubscribeToken);
    const ok = await sendMail({
      to: u.email, subject, text, locale: u.locale === "en" ? "en" : "fr",
      // Lien suivi : visites et inscriptions comptées dans le bilan envoyé à l'organisateur.
      cta: order ? { label: "Voir l'événement et s'inscrire", href: order.trackCode ? trackedPath(order.trackCode) : `/evenements/${order.eventId}` } : { label: "Ouvrir KolBase", href: "/" },
      unsubscribe: { page: `${app()}/desinscription/${token}`, oneClick: `${app()}/api/desinscription/${token}` },
    }).catch((e) => { console.error("[lettre d'information]", u.email, e); return false; });
    if (ok) sent++;
  }
  await db.newsletterCampaign.upsert({
    where: { orderId: order?.id ?? "__aucune__" },
    update: { subject, body, recipients: sent, sentAt: new Date() },
    create: { orderId: order?.id ?? null, subject, body, recipients: sent, sentAt: new Date(), createdById: admin.id },
  });
  await audit(admin.id, "newsletter.send", "NewsletterCampaign", order?.id ?? "libre", { recipients: sent });
  if (order) {
    await db.serviceOrder.update({ where: { id: order.id }, data: { status: "realisee", doneAt: new Date(), adminNote: `Lettre envoyée à ${sent} membre${sent > 1 ? "s" : ""}.` } });
    await invoiceOrder(order.id).catch((e) => console.error("[facturation du service]", e));
    notifyServiceOrder(order.id);
    refresh(order.organizationId, order.eventId);
  }
  return { ok: `Lettre envoyée à ${sent} membre${sent > 1 ? "s" : ""}.` };
}

/** Brouillon d'e-mailing ou de post pour un événement commandé (assistant d'IA). */
export async function draftServiceText(form: FormData): Promise<{ text?: string; error?: string }> {
  const admin = await requirePlatformAdmin();
  if (!aiEnabled()) return { error: "L'assistant n'est pas activé." };
  const key = `ai:${admin.id}`;
  if (blockedFor(key, 30, 3600_000)) return { error: "Réessayez dans une heure." };
  const o = await db.serviceOrder.findUnique({ where: { id: str(form, "orderId") }, include: { offer: true, organization: { select: { name: true } }, event: true } });
  if (!o) return { error: "Commande introuvable." };
  const e = o.event;
  const link = `${app()}${o.trackCode ? trackedPath(o.trackCode) : `/evenements/${o.eventId}`}`;
  const kind = o.offer.kind === "social" ? `un post LinkedIn (6 à 8 lignes, 3 hashtags sobres en fin de texte) contenant le lien d'inscription ${link}` : "le texte d'un e-mail (8 à 12 lignes) adressé à des chirurgiens-dentistes";
  const prompt = `Événement scientifique organisé par ${o.organization.name} : « ${e.title} », le ${formatDate(e.startsAt)} à ${formatTime(e.startsAt)}${e.format === "DISTANCIEL" ? ", en ligne" : e.city ? `, à ${e.city}${e.venue ? ` (${e.venue})` : ""}` : ""}.${e.therapeuticArea ? ` Domaine : ${e.therapeuticArea}.` : ""}\n${e.description ? `Présentation : ${e.description.slice(0, 1200)}\n` : ""}${e.program ? `Programme : ${e.program.slice(0, 1200)}\n` : ""}${o.brief ? `Consignes de l'organisateur : ${o.brief.slice(0, 800)}\n` : ""}\nRédige ${kind} pour faire connaître cet événement et inviter à s'inscrire sur KolBase. Ton professionnel et sobre, aucune allégation sur des produits ; termine par l'invitation à s'inscrire.`;
  hit(key);
  try {
    const text = await aiComplete(prompt, 700);
    await audit(admin.id, "ai.service_draft", "ServiceOrder", o.id);
    return { text };
  } catch {
    return { error: "L'assistant n'a pas pu répondre." };
  }
}

// ─── Membre ────────────────────────────────────────────────────────────────

/** Désinscription de la lettre d'information (lien reçu par e-mail). */
export async function unsubscribe(form: FormData) {
  const token = str(form, "token");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return;
  const u = await db.user.findUnique({ where: { unsubscribeToken: token }, select: { id: true, notifyPrefs: true } });
  if (!u) return;
  const prefs = u.notifyPrefs && typeof u.notifyPrefs === "object" ? (u.notifyPrefs as Record<string, unknown>) : {};
  await db.user.update({ where: { id: u.id }, data: { notifyPrefs: { ...prefs, newsletter: false, newsletterAsked: true } } });
  await audit(u.id, "user.newsletter_off", "User", u.id);
  revalidatePath(`/desinscription/${token}`);
}
