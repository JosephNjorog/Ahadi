import { AppError } from "@ahadi/core";
import type { AgentRow, PromiseRow, User } from "@ahadi/db";

/** Who is performing an action. Authorization checks live here so web, MCP and WhatsApp share them (SPEC §19). */
export type Actor =
  | { kind: "user"; user: Pick<User, "id" | "email" | "role" | "displayName"> }
  | {
      kind: "agent";
      agent: Pick<AgentRow, "id" | "ownerId" | "name" | "kind">;
      owner: Pick<User, "id" | "email" | "role" | "displayName">;
    }
  | { kind: "system" }
  | { kind: "paypal" };

export const SYSTEM: Actor = { kind: "system" };
export const PAYPAL: Actor = { kind: "paypal" };

export function actorTag(a: Actor): string {
  if (a.kind === "user") return a.user.role === "admin" ? `admin:${a.user.id}` : `user:${a.user.id}`;
  if (a.kind === "agent") return `agent:${a.agent.id}`;
  return a.kind;
}

export type PartyRole = "client" | "worker";

type Parties = Pick<PromiseRow, "clientUserId" | "workerUserId"> &
  Partial<Pick<PromiseRow, "clientAgentId" | "workerAgentId">>;

export function partyRole(a: Actor, p: Parties): PartyRole | null {
  if (a.kind === "user") {
    if (p.clientUserId === a.user.id) return "client";
    if (p.workerUserId === a.user.id) return "worker";
    return null;
  }
  if (a.kind === "agent") {
    if (p.clientAgentId === a.agent.id) return "client";
    if (p.workerAgentId === a.agent.id) return "worker";
  }
  return null;
}

/** The human the actor ultimately is (agents act for their owner). */
export function actorUserId(a: Actor): string | null {
  if (a.kind === "user") return a.user.id;
  if (a.kind === "agent") return a.owner.id;
  return null;
}

export function isAdmin(a: Actor): boolean {
  return a.kind === "user" && a.user.role === "admin";
}

export function assertParty(
  a: Actor,
  p: Pick<PromiseRow, "clientUserId" | "workerUserId">,
  role?: PartyRole,
): PartyRole {
  const r = partyRole(a, p);
  if (!r) throw new AppError("FORBIDDEN", "You are not a party to this promise");
  if (role && r !== role) throw new AppError("FORBIDDEN", `Only the ${role} can do this`);
  return r;
}

export function assertCanView(a: Actor, p: Parties) {
  if (a.kind === "system" || a.kind === "paypal") return;
  if (isAdmin(a) || partyRole(a, p)) return;
  throw new AppError("NOT_FOUND", "Promise not found");
}

export function assertAdmin(a: Actor) {
  if (!isAdmin(a)) throw new AppError("FORBIDDEN", "Admin only");
}
