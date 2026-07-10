import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.ts";
import { configPayload } from "./config.ts";
import { sanitizeAnalysis } from "./demo.ts";
import {
  signup, login, startSession, endSession, currentUser, requireAuth, publicUser,
  requestPasswordReset, completePasswordReset,
} from "./auth.ts";
import { sendResetEmail } from "./email.ts";
import {
  listStyles, getStyle, createStyle, updateStyle, deleteStyle, setShare, getStyleByShareId,
} from "./store.ts";
import { ingestSample, type RawSample } from "./ingest.ts";
import { analyzeSamples, currentMode } from "./provider.ts";
import type { ConsoleState, User, Source } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const app = express();
app.use(express.json({ limit: "12mb" })); // room for base64-encoded pdf/docx uploads

// ---- Helpers --------------------------------------------------------------

function userOf(req: express.Request): User {
  return (req as express.Request & { user: User }).user;
}

/** Coerce untrusted input into a valid ConsoleState (drops unknown keys). */
function sanitizeState(input: unknown): ConsoleState {
  // sanitizeAnalysis does all the per-field coercion (enums, caps, trims); the
  // console state is just that result without the analysis-only `summary`.
  const a = sanitizeAnalysis((input ?? {}) as Record<string, unknown>);
  return { persona: a.persona, dimensions: a.dimensions, matrix: a.matrix, vocab: a.vocab };
}

function shareUrl(req: express.Request, shareId: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = req.headers.host;
  return `${proto}://${host}/s/${shareId}`;
}

// ---- Meta -----------------------------------------------------------------

app.get("/api/config", (_req, res) => {
  res.json({ ...configPayload(), mode: currentMode() });
});

// ---- Auth -----------------------------------------------------------------

app.post("/api/auth/signup", (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const { user, error } = signup(email, password);
  if (error || !user) return res.status(400).json({ error });
  startSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const { user, error } = login(email, password);
  if (error || !user) return res.status(401).json({ error });
  startSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  res.json({ user: publicUser(user) });
});

// Request a reset link. Always returns { ok: true } — never reveals whether the
// email is registered.
app.post("/api/auth/forgot", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const { rawToken, user } = requestPasswordReset(email);
  if (rawToken && user) {
    const base = env.appUrl || `${(req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol}://${req.headers.host}`;
    await sendResetEmail(user.email, `${base}/reset/${rawToken}`);
  }
  res.json({ ok: true });
});

app.post("/api/auth/reset", (req, res) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Token and password are required." });
  }
  const { user, error } = completePasswordReset(token, password);
  if (error || !user) return res.status(400).json({ error });
  startSession(res, user);
  res.json({ user: publicUser(user) });
});

// ---- Styles ---------------------------------------------------------------

app.get("/api/styles", requireAuth, (req, res) => {
  res.json({ styles: listStyles(userOf(req).id) });
});

app.post("/api/styles", requireAuth, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  res.json({ style: createStyle(userOf(req).id, name) });
});

app.get("/api/styles/:id", requireAuth, (req, res) => {
  const style = getStyle(userOf(req).id, req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found." });
  res.json({ style });
});

app.put("/api/styles/:id", requireAuth, (req, res) => {
  const patch: { name?: string; state?: ConsoleState } = {};
  if (typeof req.body?.name === "string") patch.name = req.body.name;
  if (req.body?.state !== undefined) patch.state = sanitizeState(req.body.state);
  const style = updateStyle(userOf(req).id, req.params.id, patch);
  if (!style) return res.status(404).json({ error: "Style not found." });
  res.json({ style });
});

app.delete("/api/styles/:id", requireAuth, (req, res) => {
  const ok = deleteStyle(userOf(req).id, req.params.id);
  if (!ok) return res.status(404).json({ error: "Style not found." });
  res.json({ ok: true });
});

// Analyze writing samples → suggested console settings. Also records the
// sources on the style so the user can see what fed the calibration.
app.post("/api/styles/:id/analyze", requireAuth, async (req, res) => {
  const userId = userOf(req).id;
  const style = getStyle(userId, req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found." });

  const raw = Array.isArray(req.body?.samples) ? (req.body.samples as RawSample[]) : [];
  if (raw.length === 0) return res.status(400).json({ error: "Add at least one writing sample." });

  const ingested = (await Promise.all(raw.slice(0, 8).map(ingestSample))).filter(
    (s): s is NonNullable<typeof s> => s !== null,
  );
  if (ingested.length === 0) {
    return res.status(422).json({
      error: "Couldn't read enough text from those samples. Check the URLs, or paste the text directly.",
    });
  }

  const analysis = await analyzeSamples(ingested.map((s) => ({ label: s.source.label, text: s.text })));

  // Merge new sources onto the style (cap the stored history).
  const newSources: Source[] = ingested.map((s) => s.source);
  const sources = [...newSources, ...style.sources].slice(0, 20);
  updateStyle(userId, req.params.id, { sources });

  res.json({ analysis, sources, mode: currentMode() });
});

app.post("/api/styles/:id/share", requireAuth, (req, res) => {
  const enabled = req.body?.enabled !== false; // default to enabling
  const style = setShare(userOf(req).id, req.params.id, enabled);
  if (!style) return res.status(404).json({ error: "Style not found." });
  res.json({
    shareId: style.shareId,
    url: style.shareId ? shareUrl(req, style.shareId) : null,
  });
});

// ---- Public share view (no auth) ------------------------------------------

app.get("/api/share/:shareId", (req, res) => {
  const style = getStyleByShareId(req.params.shareId);
  if (!style || !style.shareId) return res.status(404).json({ error: "Shared style not found." });
  // Only expose what a read-only card needs — never the owner's identity.
  res.json({
    style: { name: style.name, state: style.state, updatedAt: style.updatedAt },
    ...configPayload(),
  });
});

// ---- Static + SPA fallback ------------------------------------------------

app.use(express.static(PUBLIC_DIR));

// Share links and any other non-API path render the single-page app.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(env.port, () => {
  console.log(`Voice Tuner running at http://localhost:${env.port}  [mode: ${currentMode()}]`);
});
