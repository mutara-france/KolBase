import "server-only";
import { sendLater } from "@/lib/mail";
import { issueToken } from "@/lib/tokens";

/**
 * Lien de confirmation d'adresse (valable 7 jours) ; `next` : page où revenir ensuite (invitation…). La lettre
 * d'information n'est donnée comme raison qu'à un praticien (elle leur est réservée). Module serveur, hors des actions :
 * appelé à l'inscription, depuis « Mon compte » et par l'équipe KolBase (fiche d'un compte).
 */
export async function sendVerification(user: { id: string; email: string; firstName: string }, practitioner: boolean, next?: string | null) {
  const token = await issueToken(user.id, "VERIFY_EMAIL", next);
  const why = practitioner
    ? "Le reste de KolBase fonctionne sans cette confirmation ; elle est nécessaire pour recevoir la lettre d'information."
    : "C'est à cette adresse que KolBase vous écrit (invitations, demandes, factures).";
  sendLater({
    to: user.email,
    subject: "Confirmez votre adresse e-mail — KolBase",
    text: `Bonjour ${user.firstName},\n\nConfirmez votre adresse e-mail en un clic. ${why} Le lien est valable 7 jours et ne sert qu'une fois.\n\nSi vous n'avez pas créé de compte, ignorez ce message.`,
    cta: { label: "Confirmer mon adresse", href: `/confirmer-email/${token}` },
  });
}
