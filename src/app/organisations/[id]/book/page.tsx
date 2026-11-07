import { redirect } from "next/navigation";

/** Ancienne adresse de la vitrine d'un prestataire (liens déjà envoyés). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/organisations/${id}/vitrine`);
}
