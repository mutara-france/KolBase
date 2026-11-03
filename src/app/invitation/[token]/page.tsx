import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { findInvitation, roleLabel } from "@/lib/orgs";
import { acceptInvitation } from "@/lib/org-actions";
import { getT } from "@/lib/i18n/server";
import { mailEnabled } from "@/lib/mail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Invitation")} — KolBase` };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv, user] = await Promise.all([findInvitation(token), getCurrentUser()]);
  const { t } = await getT();
  const valid = inv && !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date();
  const back = encodeURIComponent(`/invitation/${token}`);
  // Invitation nominative : seul le compte de l'adresse invitée peut l'accepter.
  const wrongAccount = !!(valid && inv.email && user && user.email.toLowerCase() !== inv.email.toLowerCase());
  const unconfirmed = !!(valid && inv.email && user && !wrongAccount && mailEnabled() && !user.emailVerifiedAt);

  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow">
        <div className="card form">
          {!valid ? (
            <>
              <h1>{t("Invitation indisponible")}</h1>
              <p className="muted">{t("Ce lien a expiré, a déjà été utilisé ou a été révoqué. Demandez-en un nouveau à l'administrateur de l'organisation.")}</p>
            </>
          ) : (
            <>
              <h1>{t("Rejoindre {name}", { name: inv.organization.name })}</h1>
              <p className="muted">
                {t("{name} vous invite avec le rôle", { name: `${inv.invitedBy.firstName} ${inv.invitedBy.lastName}` })} <strong>{t(roleLabel(inv.role, inv.organization.kind))}</strong>.
              </p>
              {wrongAccount ? (
                <p className="notice warn">
                  {t("Cette invitation est destinée à {email}. Connectez-vous avec cette adresse (vous êtes connecté en tant que {current}).", { email: inv.email!, current: user!.email })}
                </p>
              ) : unconfirmed ? (
                <p className="notice warn">
                  {t("Confirmez d'abord votre adresse e-mail avec le lien reçu à l'inscription (il peut être renvoyé depuis « Mon compte »), puis revenez sur cette page.")}
                </p>
              ) : user ? (
                <form action={acceptInvitation}>
                  <input type="hidden" name="token" value={token} />
                  <p className="muted">{t("Connecté en tant que {email}.", { email: user.email })}</p>
                  <button className="btn">{t("Accepter l'invitation")}</button>
                </form>
              ) : (
                <div className="actions">
                  <Link className="btn" href={`/connexion?next=${back}`}>{t("Se connecter pour accepter")}</Link>
                  <Link className="btn ghost" href={`/inscription?profil=organisation&next=${back}`}>{t("Créer un compte")}</Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
