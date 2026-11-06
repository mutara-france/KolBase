// Bandeau cookies : chaque session de test a déjà fait son choix (refus), pour que le bandeau ne recouvre pas les
// pages vérifiées. Une session ouverte avec { consent: false } n'a pas encore choisi (vérifications du bandeau).
export function withConsent(browser, base) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const { consent = true, ...rest } = options;
    const ctx = await newContext(rest);
    if (consent) await ctx.addCookies([{ name: "kb_consent", value: `1.${Math.floor(Date.now() / 1000)}.00`, url: base }]);
    return ctx;
  };
  return browser;
}
