import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { after } from "next/server";
import { appUrl } from "@/lib/ics";
import { makeT, type Locale } from "@/lib/i18n";

/**
 * Envoi d'e-mails par SMTP (Brevo, Postmark, Resend, OVH… : tous fournissent un accès SMTP).
 * SMTP_URL, par exemple smtps://utilisateur:motdepasse@smtp-relay.brevo.com:465 ; MAIL_FROM, l'expéditeur.
 * Sans SMTP_URL (développement), le contenu est écrit dans les journaux du serveur au lieu d'être envoyé.
 */
const g = globalThis as unknown as { kbMailer?: Transporter | null };
const transport = () => (g.kbMailer ??= process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null);

export const mailEnabled = () => !!process.env.SMTP_URL;
const FROM = () => process.env.MAIL_FROM ?? "KolBase <no-reply@kolbase.fr>";

export type Mail = { to: string; subject: string; text: string; cta?: { label: string; href: string }; locale?: Locale; /** Lettre d'information : lien de désinscription (pied de page et en-têtes List-Unsubscribe). */ unsubscribe?: { page: string; oneClick: string } };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Habillage commun : texte brut, et HTML sobre aux couleurs de KolBase. */
export function renderMail(m: Mail) {
  const link = m.cta ? (m.cta.href.startsWith("http") ? m.cta.href : `${appUrl()}${m.cta.href}`) : null;
  const t = makeT(m.locale ?? "fr");
  const footer = m.unsubscribe
    ? `${t("KolBase — praticiens × organisations du secteur dentaire.")}\n${t("Se désinscrire de la lettre d'information")} : ${m.unsubscribe.page}`
    : `${t("KolBase — praticiens × organisations du secteur dentaire.")}\n${t("Gérer vos notifications")} : ${appUrl()}/compte`;
  const text = [m.text, link ? `${m.cta!.label} : ${link}` : null, "—", footer].filter(Boolean).join("\n\n");
  const paragraphs = m.text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const button = link
    ? `<p style="margin:22px 0"><a href="${esc(link)}" style="background:#1a0099;color:#fff;padding:11px 18px;border-radius:999px;text-decoration:none;font-weight:600">${esc(m.cta!.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="${m.locale ?? "fr"}"><body style="margin:0;background:#f5f4fb;font-family:Arial,sans-serif;color:#14123a">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<p style="font-size:22px;font-weight:700;color:#0e0066;margin:0 0 20px">KolBase</p>
<div style="background:#fff;border-radius:14px;padding:24px;font-size:15px;line-height:1.5">${paragraphs}${button}</div>
<p style="font-size:12px;color:#6b6990;margin:16px 4px">${esc(t("KolBase — praticiens × organisations du secteur dentaire."))}<br>${m.unsubscribe ? `<a href="${esc(m.unsubscribe.page)}" style="color:#6b6990">${esc(t("Se désinscrire de la lettre d'information"))}</a>` : `<a href="${esc(appUrl())}/compte" style="color:#6b6990">${esc(t("Gérer vos notifications"))}</a>`}</p>
</div></body></html>`;
  return { text, html };
}

/**
 * Domaines réservés (.local, .test, .invalid, .example) : comptes de démonstration, rien n'y est envoyé
 * (des rebonds nuiraient à la réputation de l'expéditeur). MAIL_DELIVER_RESERVED=1 lève ce filtre pour les tests.
 */
export const isReservedAddress = (to: string) => /\.(local|test|invalid|example)$/i.test(to.trim()) && process.env.MAIL_DELIVER_RESERVED !== "1";

export async function sendMail(m: Mail): Promise<boolean> {
  if (isReservedAddress(m.to)) return false;
  const { text, html } = renderMail(m);
  const t = transport();
  if (!t) {
    // En production, le contenu n'est jamais journalisé : il peut contenir un lien de réinitialisation ou d'invitation.
    const body = process.env.NODE_ENV === "production" ? "(contenu masqué)" : `\n${text}`;
    console.info(`[e-mail non envoyé : SMTP_URL absent] À : ${m.to} — ${m.subject} ${body}`);
    return false;
  }
  const headers = m.unsubscribe ? { "List-Unsubscribe": `<${m.unsubscribe.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
  await t.sendMail({ from: FROM(), to: m.to, subject: m.subject, text, html, headers });
  return true;
}

/** Envoi après la réponse (l'utilisateur n'attend pas le serveur SMTP) ; une erreur est journalisée, pas propagée. */
export function sendLater(...mails: Mail[]) {
  if (mails.length === 0) return;
  after(async () => {
    for (const m of mails) await sendMail(m).catch((e) => console.error(`[e-mail en échec] ${m.to} — ${m.subject}`, e));
  });
}
