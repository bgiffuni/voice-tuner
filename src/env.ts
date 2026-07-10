// Tiny .env loader + typed access to the environment. No dependency on dotenv:
// we parse a .env file once at startup (if present) and fall back to real env
// vars, which always win over the file.
import fs from "node:fs";
import path from "node:path";

function loadDotEnv(): void {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

export const env = {
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || "",
  provider: (process.env.PROVIDER?.trim().toLowerCase() || "") as "live" | "demo" | "",
  model: process.env.MODEL?.trim() || "claude-opus-4-8",
  port: Number(process.env.PORT) || 4344,
  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() || "",
  sessionSecret: process.env.SESSION_SECRET?.trim() || "",
  secureCookies: process.env.SECURE_COOKIES === "1",
  dataDir: process.env.DATA_DIR?.trim() || "./data",
  // Password-reset email delivery (pick one; else links are logged to console)
  smtpHost: process.env.SMTP_HOST?.trim() || "",
  smtpPort: Number(process.env.SMTP_PORT) || 465,
  smtpUser: process.env.SMTP_USER?.trim() || "",
  smtpPass: process.env.SMTP_PASS || "",
  resendKey: process.env.RESEND_API_KEY?.trim() || "",
  resetEmailFrom: process.env.RESET_EMAIL_FROM?.trim() || "Voice Tuner <noreply@gonemo.ai>",
  appUrl: process.env.APP_URL?.trim() || "",
};

/** Which backend will actually run: forced by PROVIDER, else live iff a key exists. */
export function activeMode(): "live" | "demo" {
  if (env.provider === "live") return "live";
  if (env.provider === "demo") return "demo";
  return env.anthropicKey ? "live" : "demo";
}
