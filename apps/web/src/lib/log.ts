/**
 * The server-side logger for this app's route handlers (decision 37).
 *
 * A module-level instance rather than an injected one, which is the opposite
 * of the convention in `apps/cujo` and deliberate: nothing here is unit-tested
 * through the logger. `apps/web`'s vitest config covers "data-layer units
 * only" — the pure functions — and the route handlers are verified in the
 * browser, so there is no test that would need to capture a sink. What *is*
 * tested is `lib/api/upstream.ts`, which decides what a failure line says
 * without needing a logger at all.
 */

import { createLogger, parseLevel } from "@cujo/log";

export const log = createLogger({
  service: "web",
  level: parseLevel(process.env.CUJO_LOG_LEVEL),
});
