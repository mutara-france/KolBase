/** Surveillance : toute erreur serveur (page, action, route) est journalisée et signalée aux administrateurs. */
export async function register() {}

export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring");
  await reportError(err, { path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType });
}
