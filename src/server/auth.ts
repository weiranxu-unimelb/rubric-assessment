import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { adminScopes, employees, sessions } from "./db/schema";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "rubric_session";
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type Actor = {
  employeeNo: string;
  name: string;
  subsidiaryId: string;
  isSuperAdmin: boolean;
  adminSubsidiaryIds: string[];
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, saved] = encoded.split(":");
  if (!salt || !saved || !/^[a-f0-9]{128}$/.test(saved)) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(saved, "hex"));
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(employeeNo: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_AGE_MS);
  await db.insert(sessions).values({ tokenHash: tokenHash(token), employeeNo, expiresAt });
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.SESSION_COOKIE_SECURE === "true" || (process.env.SESSION_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production"),
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  jar.delete(COOKIE_NAME);
}

export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await db.select({ employeeNo: sessions.employeeNo })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session[0]) return null;
  const employee = await db.select({
    employeeNo: employees.employeeNo,
    name: employees.name,
    subsidiaryId: employees.subsidiaryId,
    isSuperAdmin: employees.isSuperAdmin,
  }).from(employees).where(and(eq(employees.employeeNo, session[0].employeeNo), eq(employees.status, "ACTIVE"))).limit(1);
  if (!employee[0]) return null;
  const scopes = await db.select({ subsidiaryId: adminScopes.subsidiaryId })
    .from(adminScopes).where(eq(adminScopes.adminEmployeeNo, employee[0].employeeNo));
  return { ...employee[0], adminSubsidiaryIds: scopes.map((scope) => scope.subsidiaryId) };
}

export function mayAdmin(actor: Actor, subsidiaryId: string): boolean {
  return actor.isSuperAdmin || actor.adminSubsidiaryIds.includes(subsidiaryId);
}
