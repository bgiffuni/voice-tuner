// Password-reset email delivery. Three backends, in priority order:
//   1. SMTP (nodemailer) if SMTP_HOST is set — e.g. Google Workspace.
//   2. Resend (HTTP API) if RESEND_API_KEY is set.
//   3. Console fallback — the reset link is logged (handy for local dev).
import nodemailer from "nodemailer";
import { env } from "./env.ts";

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function sendSmtp(mail: Mail): Promise<boolean> {
  try {
    const transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
    await transport.sendMail({ from: env.resetEmailFrom, ...mail });
    return true;
  } catch (err) {
    console.error("[email] SMTP send failed:", (err as Error).message);
    return false;
  }
}

async function sendResend(mail: Mail): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.resetEmailFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) {
      console.error("[email] Resend failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Resend send failed:", (err as Error).message);
    return false;
  }
}

export async function sendResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Reset your Voice Tuner password";
  const text =
    `Someone asked to reset the password for your Voice Tuner account.\n\n` +
    `Reset it here (link expires in 1 hour):\n${resetUrl}\n\n` +
    `If this wasn't you, you can safely ignore this email.\n\n— Voice Tuner by Gonemo`;
  const html =
    `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-family:Georgia,serif">Reset your password</h2>
      <p>Someone asked to reset the password for your Voice Tuner account.</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#C99A44;color:#2A241D;text-decoration:none;padding:11px 20px;border-radius:24px;font-weight:600">Choose a new password</a></p>
      <p style="color:#666;font-size:13px">This link expires in 1 hour. If it wasn't you, ignore this email.</p>
      <p style="color:#999;font-size:12px">Voice Tuner — a <a href="https://www.gonemo.ai">Gonemo</a> project</p>
    </div>`;

  const mail: Mail = { to, subject, text, html };
  let sent = false;
  if (env.smtpHost) sent = await sendSmtp(mail);
  else if (env.resendKey) sent = await sendResend(mail);

  if (!sent) {
    // No backend configured (or it failed): log the link so dev/local still works.
    console.log(`\n[email] Password reset link for ${to}:\n  ${resetUrl}\n`);
  }
}
