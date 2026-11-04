import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignInForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Connexion")} — KolBase` };
}

/** Lien de confirmation d'adresse ouvert sans être connecté (autre appareil, navigateur) : le résultat est dit ici. */
const EMAIL_NOTICE = {
  confirme: ["ok", "Adresse e-mail confirmée. Connectez-vous pour continuer."],
  "deja-confirme": ["ok", "Votre adresse e-mail est déjà confirmée : ce lien a déjà servi. Connectez-vous pour continuer."],
  "lien-invalide": ["error", "Ce lien de confirmation n'est plus valable (déjà utilisé ou expiré). Connectez-vous : si votre adresse n'est pas confirmée, vous pourrez demander un nouveau lien depuis « Mon compte »."],
} as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  // Déjà connecté : on va directement là où le lien menait.
  if (await getCurrentUser()) redirect(safeNext(next, "/compte"));
  const { t } = await getT();
  const notice = email && email in EMAIL_NOTICE ? EMAIL_NOTICE[email as keyof typeof EMAIL_NOTICE] : null;
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow">
        {notice && <p className={`notice ${notice[0]}`} role="status">{t(notice[1])}</p>}
        <SignInForm next={next} />
      </main>
    </>
  );
}
