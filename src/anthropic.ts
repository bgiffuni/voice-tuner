// Live analyzer: ask Claude to read the writing samples and set the console.
// Uses a forced tool call so the response is always structured JSON we can
// parse; any failure falls back to the offline heuristic so the app never
// hard-fails on a flaky call.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import { ADJECTIVES, MUTES, SOLOS, MUTE_KEYS, SOLO_KEYS, ADJECTIVE_SET } from "./config.ts";
import { analyzeHeuristic } from "./demo.ts";
import type { AnalysisResult } from "./types.ts";

const clamp = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50;
};

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_voice",
  description: "Report the writing voice estimated from the samples.",
  input_schema: {
    type: "object",
    properties: {
      adjectives: {
        type: "array",
        items: { type: "string", enum: ADJECTIVES },
        description: "Exactly 3 identity words, chosen only from the allowed list.",
      },
      tech: { type: "integer", description: "0 = always plain language, 100 = full technical depth." },
      wit: { type: "integer", description: "0 = straightforward, 100 = playful & bold." },
      formality: { type: "integer", description: "0 = casual, 100 = formal & polished." },
      pace: { type: "integer", description: "0 = detailed & thorough, 100 = tight & concise." },
      mutes: {
        type: "array",
        items: { type: "string", enum: MUTES.map((m) => m.key) },
        description: "Keys of habits this writer clearly avoids and should keep avoiding.",
      },
      solos: {
        type: "array",
        items: { type: "string", enum: SOLOS.map((s) => s.key) },
        description: "Keys of strengths this writing is known for.",
      },
      summary: { type: "string", description: "One or two sentences describing the voice in plain language." },
    },
    required: ["adjectives", "tech", "wit", "formality", "pace", "mutes", "solos", "summary"],
  },
};

function buildPrompt(samples: { label: string; text: string }[]): string {
  const muteList = MUTES.map((m) => `- ${m.key}: ${m.label}`).join("\n");
  const soloList = SOLOS.map((s) => `- ${s.key}: ${s.label}`).join("\n");
  const body = samples
    .map((s, i) => `--- SAMPLE ${i + 1} (${s.label}) ---\n${s.text}`)
    .join("\n\n");
  return (
    `You are calibrating a "mixing console" that describes a person's writing voice. ` +
    `Read the writing samples below and estimate where this writer's voice actually sits — ` +
    `not where they might wish it sat. Judge from the prose itself: sentence length, register, ` +
    `humor, technical depth, hedging, punctuation habits.\n\n` +
    `Four faders, each 0–100:\n` +
    `- tech: 0 plain language … 100 full technical depth\n` +
    `- wit: 0 straightforward … 100 playful & bold\n` +
    `- formality: 0 casual … 100 formal & polished\n` +
    `- pace: 0 detailed & thorough … 100 tight & concise\n\n` +
    `"Mute" keys (habits the writer avoids and should keep avoiding), choose only those that clearly apply:\n${muteList}\n\n` +
    `"Solo" keys (strengths this writing is known for), choose only those clearly demonstrated:\n${soloList}\n\n` +
    `Pick exactly 3 adjectives from the allowed list. Then call report_voice.\n\n` +
    `WRITING SAMPLES:\n\n${body}`
  );
}

function sanitize(input: Record<string, unknown>): AnalysisResult {
  const adjectives = Array.isArray(input.adjectives)
    ? input.adjectives.filter((a): a is string => typeof a === "string" && ADJECTIVE_SET.has(a)).slice(0, 3)
    : [];
  const mutes = Array.isArray(input.mutes)
    ? [...new Set(input.mutes.filter((m): m is string => typeof m === "string" && MUTE_KEYS.has(m)))]
    : [];
  const solos = Array.isArray(input.solos)
    ? [...new Set(input.solos.filter((s): s is string => typeof s === "string" && SOLO_KEYS.has(s)))]
    : [];
  return {
    adjectives,
    tech: clamp(input.tech),
    wit: clamp(input.wit),
    formality: clamp(input.formality),
    pace: clamp(input.pace),
    mutes,
    solos,
    summary: typeof input.summary === "string" ? input.summary : "",
  };
}

export async function analyzeWithClaude(
  samples: { label: string; text: string }[],
): Promise<AnalysisResult> {
  const client = new Anthropic({ apiKey: env.anthropicKey });
  try {
    const res = await client.messages.create({
      model: env.model,
      max_tokens: 1024,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: "report_voice" },
      messages: [{ role: "user", content: buildPrompt(samples) }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") {
      return sanitize(block.input as Record<string, unknown>);
    }
    throw new Error("No tool_use block in response");
  } catch (err) {
    // Fall back to the offline heuristic on the combined text so the user still
    // gets a usable calibration.
    console.error("[analyze] live call failed, falling back to heuristic:", (err as Error).message);
    const combined = samples.map((s) => s.text).join("\n\n");
    return analyzeHeuristic(combined);
  }
}
