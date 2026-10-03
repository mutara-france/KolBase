import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { findInvitation, ROLE_LABEL } from "@/lib/orgs";
import { acceptInvitation } from "@/lib/org-actions";

export const metadata = { title: "Invitation — Kolbase" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv, user] = await Promise.all([findInvitation(token), getCurrentUser()]);
  const valid = inv && !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date();
  const back = encodeURIComponent(`/invitation/${token}`);

  return (
    <>
      <SiteHeader />
      <main className="narrow">
        <div className="card form">
          {!valid ? (
            <>
              <h1>Invitation indisponible</h1>
              <p className="muted">Ce lien a expiré, a déjà été utilisé ou a été révoqué. Demandez-en un nouveau à l&apos;administrateur de l&apos;organisation.</p>
            </>
          ) : (
            <>
              <h1>Rejoindre {inv.organization.name}</h1>
              <p className="muted">
                {inv.invitedBy.firstName} {inv.invitedBy.lastName} vous invite avec le rôle <strong>{ROLE_LABEL[inv.role]}</strong>.
              </p>
              {user ? (
                <form action={acceptInvitation}>
                  <input type="hidden" name="token" value={token} />
                  <p className="muted">Connecté en tant que {user.email}.</p>
                  <button className="btn">Accepter l&apos;invitation</button>
                </form>
              ) : (
                <div className="actions">
                  <Link className="btn" href={`/connexion?next=${back}`}>Se connecter pour accepter</Link>
                  <Link className="btn ghost" href={`/inscription?next=${back}`}>Créer un compte</Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
