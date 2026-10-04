import { redirect } from "next/navigation";

// La fiche détaillée est désormais unique : /experts/[id], adaptée au visiteur.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/experts/${id}`);
}
