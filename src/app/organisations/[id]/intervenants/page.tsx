import { redirect } from "next/navigation";

/** Ancienne page des appels à intervenants : ils sont désormais des appels à candidatures rattachés à un événement. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/organisations/${id}/opportunites`);
}
