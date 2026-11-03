import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SurveyForm } from "@/components/SurveyForm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { eventEnded } from "@/lib/event-followup";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Votre avis")} — KolBase`, robots: { index: false } };
}

/** Questionnaire de satisfaction d'un participant, après l'événement. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { t } = await getT();
  const reg = await db.registration.findFirst({
    where: { eventId: id, userId: user.id },
    include: { event: { include: { organization: { select: { name: true } } } }, survey: { select: { id: true } } },
  });
  if (!reg) notFound();
  const ended = eventEnded(reg.event);
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/inscriptions">← {t("Mes inscriptions")}</Link></p>
        <div>
          <h1>{t("Votre avis")}</h1>
          <p className="muted">{t("« {title} », organisé par {org}. Vos réponses sont transmises à l'organisateur sans votre nom.", { title: reg.event.title, org: reg.event.organization.name })}</p>
        </div>
        {reg.survey ? (
          <p className="notice ok">{t("Merci : votre avis est transmis à l'organisateur, sans votre nom.")}</p>
        ) : !ended ? (
          <p className="notice">{t("Le questionnaire ouvre à la fin de l'événement.")}</p>
        ) : (
          <SurveyForm eventId={id} />
        )}
      </main>
    </>
  );
}
