import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="site-header">
      <Link href="/" className="logo">
        Kolbase<small>praticiens × organisations</small>
      </Link>
      <nav>
        {user ? (
          <>
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
