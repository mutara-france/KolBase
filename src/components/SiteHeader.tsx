import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";
import { db } from "@/lib/db";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const pending = user?.practitioner
    ? await db.projectExpert.count({ where: { practitionerId: user.practitioner.id, status: "ATT_EXPERTS", project: { status: { not: "DECLINE" } } } })
    : 0;
  return (
    <header className="site-header">
      <Link href="/" className="logo">
        Kolbase<small>praticiens × organisations</small>
      </Link>
      <nav>
        <Link href="/evenements" className="navlink">Agenda</Link>
        {user ? (
          <>
            <Link href="/inscriptions" className="navlink">Mes inscriptions</Link>
            {user.practitioner?.listed && (
              <Link href="/sollicitations" className="navlink">Sollicitations{pending > 0 && <span className="count">{pending}</span>}</Link>
            )}
            {(user.memberships.length > 0 || user.practitioner?.listed) && <Link href="/annuaire" className="navlink">Annuaire</Link>}
            {user.memberships.length > 0 && <Link href="/organisations" className="navlink">Organisations</Link>}
            <Link href="/compte" className="btn ghost">
              {user.firstName} {user.lastName}
            </Link>
            <form action={signOut}>
              <button className="btn ghost" type="submit">Se déconnecter</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/connexion" className="btn ghost">Se connecter</Link>
            <Link href="/inscription" className="btn">Créer un compte</Link>
          </>
        )}
      </nav>
    </header>
  );
}
