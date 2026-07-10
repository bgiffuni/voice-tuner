// File-backed persistence for users and styles. Small scale, so we keep it
// simple: users live in one JSON file, each style is its own JSON file under
// data/styles/<userId>/, and a shares index maps public shareIds to a style.
//
// Everything is best-effort durable: writes go through a temp file + rename so
// a crash mid-write can't corrupt a file.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "./env.ts";
import type { Style, User, ConsoleState, Source } from "./types.ts";
import { DEFAULT_STATE } from "./types.ts";

const DATA_DIR = path.resolve(process.cwd(), env.dataDir);
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STYLES_DIR = path.join(DATA_DIR, "styles");
const SHARES_FILE = path.join(DATA_DIR, "shares.json");

function ensureDirs(): void {
  fs.mkdirSync(STYLES_DIR, { recursive: true });
}
ensureDirs();

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---- Users ----------------------------------------------------------------

let users: User[] = readJson<User[]>(USERS_FILE, []);

function saveUsers(): void {
  writeJson(USERS_FILE, users);
}

export function getUserByEmail(email: string): User | undefined {
  const e = email.trim().toLowerCase();
  return users.find((u) => u.email === e);
}

export function getUserById(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

export function createUser(email: string, passwordHash: string, salt: string): User {
  const user: User = {
    id: crypto.randomUUID(),
    email: email.trim().toLowerCase(),
    passwordHash,
    salt,
    createdAt: Date.now(),
  };
  users.push(user);
  saveUsers();
  return user;
}

// ---- Shares index ---------------------------------------------------------

type ShareIndex = Record<string, { userId: string; styleId: string }>;
let shares: ShareIndex = readJson<ShareIndex>(SHARES_FILE, {});

function saveShares(): void {
  writeJson(SHARES_FILE, shares);
}

// ---- Styles ---------------------------------------------------------------

function userStylesDir(userId: string): string {
  return path.join(STYLES_DIR, userId);
}

function styleFile(userId: string, styleId: string): string {
  return path.join(userStylesDir(userId), `${styleId}.json`);
}

export function listStyles(userId: string): Style[] {
  const dir = userStylesDir(userId);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Style[] = [];
  for (const f of files) {
    const s = readJson<Style | null>(path.join(dir, f), null);
    if (s) out.push(s);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function getStyle(userId: string, styleId: string): Style | undefined {
  return readJson<Style | null>(styleFile(userId, styleId), null) ?? undefined;
}

export function createStyle(userId: string, name: string): Style {
  const now = Date.now();
  const style: Style = {
    id: crypto.randomUUID(),
    userId,
    name: name.trim() || "Untitled style",
    state: { ...DEFAULT_STATE },
    sources: [],
    shareId: null,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(styleFile(userId, style.id), style);
  return style;
}

export interface StylePatch {
  name?: string;
  state?: ConsoleState;
  sources?: Source[];
}

export function updateStyle(userId: string, styleId: string, patch: StylePatch): Style | undefined {
  const style = getStyle(userId, styleId);
  if (!style) return undefined;
  if (patch.name !== undefined) style.name = patch.name.trim() || style.name;
  if (patch.state !== undefined) style.state = patch.state;
  if (patch.sources !== undefined) style.sources = patch.sources;
  style.updatedAt = Date.now();
  writeJson(styleFile(userId, styleId), style);
  return style;
}

export function deleteStyle(userId: string, styleId: string): boolean {
  const style = getStyle(userId, styleId);
  if (!style) return false;
  if (style.shareId && shares[style.shareId]) {
    delete shares[style.shareId];
    saveShares();
  }
  try {
    fs.unlinkSync(styleFile(userId, styleId));
    return true;
  } catch {
    return false;
  }
}

export function setShare(userId: string, styleId: string, enabled: boolean): Style | undefined {
  const style = getStyle(userId, styleId);
  if (!style) return undefined;
  if (enabled) {
    if (!style.shareId) {
      style.shareId = crypto.randomBytes(9).toString("base64url");
      shares[style.shareId] = { userId, styleId };
      saveShares();
    }
  } else if (style.shareId) {
    delete shares[style.shareId];
    saveShares();
    style.shareId = null;
  }
  style.updatedAt = Date.now();
  writeJson(styleFile(userId, styleId), style);
  return style;
}

export function getStyleByShareId(shareId: string): Style | undefined {
  const ref = shares[shareId];
  if (!ref) return undefined;
  return getStyle(ref.userId, ref.styleId);
}
