import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { findInvitation, roleLabel } from "@/lib/orgs";
import { acceptInvitation } from "@/lib/org-actions";
import { getT } from "@/lib/i18n/server";

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
              {user ? (
                <form action={acceptInvitation}>
                  <input type="hidden" name="token" value={token} />
                  <p className="muted">{t("Connecté en tant que {email}.", { email: user.email })}</p>
                  <button className="btn">{t("Accepter l'invitation")}</button>
                </form>
              ) : (
                <div className="actions">
                  <Link className="btn" href={`/connexion?next=${back}`}>{t("Se connecter pour accepter")}</Link>
                  <Link className="btn ghost" href={`/inscription?next=${back}`}>{t("Créer un compte")}</Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
