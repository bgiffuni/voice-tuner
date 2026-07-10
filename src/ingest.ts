// Turn writing samples into plain text the analyzer can read. Handles two
// server-side jobs: fetching a URL and stripping it to readable prose, and
// cleaning up pasted/uploaded text. (Uploaded files are read as text on the
// client and arrive here as strings.)
import crypto from "node:crypto";
import type { Source } from "./types.ts";

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_SAMPLE_CHARS = 20_000; // per source, keeps prompts bounded
const UA = "Mozilla/5.0 (compatible; VoiceTuner/1.0; +writing-sample-capture)";

export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Strip HTML to readable text: drop script/style/nav/etc., decode entities. */
export function extractText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|head|nav|footer|form|aside)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|br|tr)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n");
  return s.trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'",
    rdquo: "”", ldquo: "“",
  };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

async function fetchUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, MAX_HTML_BYTES).toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function clip(text: string): string {
  return text.length > MAX_SAMPLE_CHARS ? text.slice(0, MAX_SAMPLE_CHARS) : text;
}

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? flat.slice(0, 180) + "…" : flat;
}

export interface IngestedSample {
  source: Source;
  text: string; // the extracted, clipped text used for analysis
}

export interface RawSample {
  type: "text" | "url" | "file";
  label?: string;
  content?: string; // for text / file
  url?: string; // for url
}

/**
 * Normalize one incoming sample into text + a Source record. Returns null if
 * nothing usable could be extracted (e.g. an unreachable URL or empty paste).
 */
export async function ingestSample(raw: RawSample): Promise<IngestedSample | null> {
  let text = "";
  let label = raw.label?.trim() || "";

  if (raw.type === "url") {
    const url = normalizeUrl(raw.url || raw.content || "");
    if (!url) return null;
    const html = await fetchUrl(url);
    if (!html) return null;
    text = extractText(html);
    label = label || url;
  } else {
    // text or file: client already gave us the text
    text = (raw.content || "").trim();
    label = label || (raw.type === "file" ? "Uploaded file" : "Pasted text");
  }

  text = clip(text.trim());
  if (text.replace(/\s+/g, "").length < 40) return null; // too little to analyze

  return {
    source: {
      id: crypto.randomUUID(),
      type: raw.type,
      label,
      excerpt: excerptOf(text),
      chars: text.length,
      addedAt: Date.now(),
    },
    text,
  };
}
