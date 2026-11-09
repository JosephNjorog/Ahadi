import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@ahadi/core/env";

export const SESSION_COOKIE = "ahadi_session";
const SESSION_TTL_S = 30 * 24 * 3600;

const key = () => new TextEncoder().encode(getEnv().SESSION_SECRET);

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .setIssuer("ahadi")
    .sign(key());
}

export async function readSessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "ahadi", algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: getEnv().NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_S,
});

export async function setSession(userId: string) {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(userId), sessionCookieOptions());
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
