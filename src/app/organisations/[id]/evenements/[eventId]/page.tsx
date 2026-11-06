import { EventWorkspace } from "@/components/EventWorkspace";
import { SiteHeader } from "@/components/SiteHeader";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Événement")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string; eventId: string }>; searchParams: Promise<{ publie?: string }> }) {
  const { id, eventId } = await params;
  const { publie } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <EventWorkspace orgId={id} eventId={eventId} publie={publie} />
      </main>
    </>
  );
}
