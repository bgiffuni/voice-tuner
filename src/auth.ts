// Accounts + sessions. Passwords are hashed with scrypt; sessions are stateless
// HMAC-signed cookies carrying the userId. No external services needed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { env } from "./env.ts";
import { createUser, getUserByEmail, getUserById } from "./store.ts";
import type { User } from "./types.ts";

const COOKIE = "vt_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ---- Session secret -------------------------------------------------------

function resolveSecret(): string {
  if (env.sessionSecret) return env.sessionSecret;
  const file = path.resolve(process.cwd(), env.dataDir, ".session-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret);
    return secret;
  }
}
const SECRET = resolveSecret();

// ---- Password hashing -----------------------------------------------------

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

// ---- Signed session token -------------------------------------------------

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function makeToken(userId: string): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  const payload = `${userId}.${expires}`;
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  return userId;
}

// ---- Cookie helpers -------------------------------------------------------

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function setSessionCookie(res: Response, token: string): void {
  const bits = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (env.secureCookies) bits.push("Secure");
  res.append("Set-Cookie", bits.join("; "));
}

function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---- Validation -----------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignup(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email)) return "Enter a valid email address.";
  if (env.allowedEmailDomain && !email.toLowerCase().endsWith(`@${env.allowedEmailDomain}`)) {
    return `Sign-ups are limited to @${env.allowedEmailDomain} addresses.`;
  }
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

// ---- Public API used by the server ----------------------------------------

export function signup(email: string, password: string): { user?: User; error?: string } {
  const err = validateSignup(email, password);
  if (err) return { error: err };
  if (getUserByEmail(email)) return { error: "An account with that email already exists." };
  const { hash, salt } = hashPassword(password);
  return { user: createUser(email, hash, salt) };
}

export function login(email: string, password: string): { user?: User; error?: string } {
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    return { error: "Incorrect email or password." };
  }
  return { user };
}

export function startSession(res: Response, user: User): void {
  setSessionCookie(res, makeToken(user.id));
}

export function endSession(res: Response): void {
  clearSessionCookie(res);
}

/** Returns the signed-in user, or undefined. */
export function currentUser(req: Request): User | undefined {
  const cookies = parseCookies(req.headers.cookie);
  const userId = readToken(cookies[COOKIE]);
  if (!userId) return undefined;
  return getUserById(userId);
}

/** Express middleware: 401s unless signed in; attaches req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  (req as Request & { user: User }).user = user;
  next();
}

export function publicUser(user: User): { id: string; email: string } {
  return { id: user.id, email: user.email };
}
