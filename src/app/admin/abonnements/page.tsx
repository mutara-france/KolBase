import { requirePlatformAdmin } from "@/lib/platform";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import { BillingAdmin, BrandDomainsAdmin } from "../_parts/sections";

export const metadata = { title: "Abonnements — Administration KolBase" };
export const dynamic = "force-dynamic";

/** Abonnements des organisations : statut, échéance, gratuité accordée par KolBase. */
export default async function Page() {
  await requirePlatformAdmin();
  return (
    <AdminFrame title="Abonnements" desc="Formule, statut et échéance de chaque organisation ; gratuité accordée par KolBase (pilote, partenaire, démonstration)." crumbs={[ADMIN_HOME]}>
      <BillingAdmin />
      <BrandDomainsAdmin />
    </AdminFrame>
  );
}
