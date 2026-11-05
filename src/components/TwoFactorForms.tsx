"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Notice } from "@/components/AuthForms";
import { useT } from "@/components/I18nProvider";
import { beginTwoFactor, confirmTwoFactor, disableTwoFactor, regenerateRecoveryCodes, setOrgTwoFactor, verifySecondFactor } from "@/lib/two-factor-actions";

/** Connexion, seconde étape : code de l'application ou code de secours. */
export function SecondFactorForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(verifySecondFactor, undefined);
  const [recovery, setRecovery] = useState(false);
  const t = useT();
  return (
    <form action={action} className="card form">
      <h1><ShieldCheck size={22} aria-hidden /> {t("Vérification en deux étapes")}</h1>
      <p className="muted">{recovery ? t("Saisissez l'un des codes de secours obtenus à l'activation (chacun ne sert qu'une fois).") : t("Saisissez le code à 6 chiffres affiché par votre application d'authentification.")}</p>
      <Notice state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <label>{recovery ? t("Code de secours") : t("Code de vérification")}
        <input key={recovery ? "r" : "c"} name="code" required autoFocus autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} maxLength={recovery ? 12 : 7} placeholder={recovery ? "abcd-efgh" : "123456"} className="mono code-input" />
      </label>
      <button className="btn" disabled={pending}>{pending ? t("Vérification…") : t("Valider")}</button>
      <p className="muted">
        <button type="button" className="link" onClick={() => setRecovery(!recovery)}>{recovery ? t("Utiliser le code de l'application") : t("Je n'ai pas mon téléphone : utiliser un code de secours")}</button>
      </p>
      <p className="muted"><Link href="/connexion">{t("Retour à la connexion")}</Link></p>
    </form>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useT();
  return (
    <div className="stack-sm recovery-box">
      <p><strong>{t("Codes de secours")}</strong> — {t("notez-les maintenant et gardez-les en lieu sûr : ils ne seront plus affichés. Chacun permet une connexion sans votre téléphone.")}</p>
      <ul className="recovery-codes mono">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <button type="button" className="btn ghost small" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>{t("Copier les codes")}</button>
    </div>
  );
}

/** « Mon compte › Sécurité » : activation (QR code, premier code, codes de secours), nouveaux codes, désactivation. */
export function TwoFactorCard({ enabledAt, setup, recoveryLeft, locked }: {
  enabledAt: string | null;
  setup: { qr: string; secret: string } | null;
  recoveryLeft: number;
  /** Exigée (organisation, administration) : la désactivation n'est pas proposée. */
  locked: boolean;
}) {
  const t = useT();
  const [confirmState, confirm, confirming] = useActionState(confirmTwoFactor, undefined);
  const [regenState, regen, regenerating] = useActionState(regenerateRecoveryCodes, undefined);
  const [disableState, disable, disabling] = useActionState(disableTwoFactor, undefined);
  if (confirmState?.codes) {
    return (
      <div className="stack-sm">
        <Notice state={confirmState} />
        <RecoveryCodes codes={confirmState.codes} />
        <p className="hint">{t("À la prochaine connexion, le code de votre application vous sera demandé après le mot de passe.")}</p>
      </div>
    );
  }
  if (!enabledAt) {
    if (!setup) {
      return (
        <form action={beginTwoFactor}>
          <button className="btn"><KeyRound size={15} /> {t("Activer la double authentification")}</button>
        </form>
      );
    }
    return (
      <form action={confirm} className="form two-factor-setup">
        <ol className="steps-list">
          <li>{t("Installez une application d'authentification sur votre téléphone (Google Authenticator, Microsoft Authenticator, 1Password…).")}</li>
          <li>{t("Scannez ce QR code avec l'application, ou saisissez la clé à la main.")}</li>
        </ol>
        <div className="two-factor-qr">
          <span className="qr" dangerouslySetInnerHTML={{ __html: setup.qr }} />
          <span className="text-sm">{t("Clé")} : <code className="mono totp-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></span>
        </div>
        <Notice state={confirmState} />
        <label>{t("Code affiché par l'application")}<input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" className="mono code-input" /></label>
        <button className="btn" disabled={confirming}>{confirming ? t("Vérification…") : t("Confirmer et activer")}</button>
      </form>
    );
  }
  return (
    <div className="stack-sm">
      <p className="notice ok"><ShieldCheck size={15} aria-hidden /> {t("Double authentification activée depuis le {date}.", { date: enabledAt })} {t("{n} code(s) de secours restant(s).", { n: recoveryLeft })}</p>
      {regenState?.codes ? <RecoveryCodes codes={regenState.codes} /> : (
        <details>
          <summary>{t("Générer de nouveaux codes de secours")}</summary>
          <form action={regen} className="form">
            <Notice state={regenState} />
            <label>{t("Code affiché par l'application")}<input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="mono code-input" /></label>
            <button className="btn secondary small" disabled={regenerating}>{t("Générer")}</button>
          </form>
        </details>
      )}
      {!locked && (
        <details>
          <summary>{t("Désactiver la double authentification")}</summary>
          <form action={disable} className="form">
            <Notice state={disableState} />
            <label>{t("Mot de passe")}<input name="password" type="password" required autoComplete="current-password" /></label>
            <button className="btn danger small" disabled={disabling}>{t("Désactiver")}</button>
          </form>
        </details>
      )}
    </div>
  );
}

/** Organisation : exiger la double authentification de tous les membres. */
export function OrgTwoFactorForm({ orgId, required, adminReady, missing }: { orgId: string; required: boolean; adminReady: boolean; missing: number }) {
  const [state, action, pending] = useActionState(setOrgTwoFactor, undefined);
  const t = useT();
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="require" value={required ? "0" : "1"} />
      <p className="muted">
        {required
          ? t("Exigée : chaque membre saisit un code de son application après son mot de passe.")
          : t("Facultative : chaque membre peut l'activer depuis « Mon compte ».")}{" "}
        {missing > 0
          ? required
            ? t(missing > 1 ? "{n} membres ne l'ont pas encore activée : il leur sera demandé de le faire à leur prochain accès." : "{n} membre ne l'a pas encore activée : il lui sera demandé de le faire à son prochain accès.", { n: missing })
            : t(missing > 1 ? "{n} membres ne l'ont pas encore activée." : "{n} membre ne l'a pas encore activée.", { n: missing })
          : t("Tous les membres l'ont activée.")}
      </p>
      {!required && !adminReady && <p className="hint">{t("Activez-la d'abord sur votre propre compte")} (<Link href="/compte#securite">{t("Mon compte › Sécurité")}</Link>).</p>}
      <button className={`btn small${required ? " ghost" : ""}`} disabled={pending || (!required && !adminReady)}>{required ? t("Ne plus l'exiger") : t("Exiger la double authentification")}</button>
    </form>
  );
}
