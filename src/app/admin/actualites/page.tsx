import { requirePlatformAdmin } from "@/lib/platform";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import { NewsAdmin } from "../_parts/sections";

export const metadata = { title: "Actualités — Administration KolBase" };
export const dynamic = "force-dynamic";

/** Actualités : brouillons et articles publiés. */
export default async function Page() {
  await requirePlatformAdmin();
  return (
    <AdminFrame title="Actualités" desc="Articles de la rubrique « Actualités » et de la page d'accueil." crumbs={[ADMIN_HOME]}>
      <NewsAdmin />
    </AdminFrame>
  );
}
