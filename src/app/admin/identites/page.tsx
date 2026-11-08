import { requirePlatformAdmin } from "@/lib/platform";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import { IdentityQueue } from "../_parts/identities";

export const metadata = { title: "Identités — Administration KolBase" };
export const dynamic = "force-dynamic";

/** Identités des praticiens : numéros à contrôler, photos récentes, derniers contrôles. */
export default async function Page() {
  await requirePlatformAdmin();
  return (
    <AdminFrame title="Identités des praticiens" desc="Numéros professionnels à contrôler sur le registre du pays d'exercice, photos publiées, derniers contrôles." crumbs={[ADMIN_HOME]}>
      <IdentityQueue />
    </AdminFrame>
  );
}
