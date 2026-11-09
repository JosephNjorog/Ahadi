import { cache } from "react";
import { getDashboardSummary } from "@ahadi/services";
import { actorFor, requireUser } from "./auth";

/**
 * Dashboard summary memoised per request (keyed by user id), so the layout's sidebar
 * badge and the dashboard page share one set of queries.
 */
export const loadSummary = cache(async (_userId: string) =>
  getDashboardSummary(actorFor(await requireUser())),
);
