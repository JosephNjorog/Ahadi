import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@ahadi/services";
import { getUserById } from "@ahadi/services";
import { SESSION_COOKIE, readSessionToken } from "./session";

/** Current user for this request (memoised per render). */
export const currentUser = cache(async () => {
  const userId = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return (await getUserById(userId)) ?? null;
});

export async function requireUser(next?: string) {
  const user = await currentUser();
  if (!user) redirect(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser("/admin");
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export function actorFor(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>): Actor {
  return { kind: "user", user };
}
