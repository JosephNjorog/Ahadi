import "server-only";
import { notFound } from "next/navigation";
import { isAppError } from "@ahadi/core";

/** Run a service call from a server component; map NOT_FOUND/FORBIDDEN to the 404 page. */
export async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}
