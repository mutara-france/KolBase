import { requirePlatformAdmin } from "@/lib/platform";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import { ServicesAdmin } from "../_parts/sections";

export const metadata = { title: "Services — Administration KolBase" };
export const dynamic = "force-dynamic";

/** Services KolBase : commandes à traiter, lettre d'information, catalogue. */
export default async function Page() {
  await requirePlatformAdmin();
  return (
    <AdminFrame title="Services KolBase" desc="Commandes des organisateurs (e-mailing, réseaux sociaux, mise à la une), lettre d'information et catalogue." crumbs={[ADMIN_HOME]}>
      <ServicesAdmin />
    </AdminFrame>
  );
}
