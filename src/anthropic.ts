// Live analyzer: ask Claude to read the writing samples and draft the brand's
// tone-of-voice guide. Uses a forced tool call so the response is always
// structured JSON we can parse; any failure falls back to the offline
// heuristic so the app never hard-fails on a flaky call.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import { DIMENSIONS, GRAMMAR } from "./config.ts";
import { analyzeHeuristic, sanitizeAnalysis } from "./demo.ts";
import type { AnalysisResult } from "./types.ts";

const dimEnum = (key: string) => DIMENSIONS.find((d) => d.key === key)!.options;

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_voice",
  description: "Report the brand tone of voice inferred from the writing samples.",
  input_schema: {
    type: "object",
    properties: {
      persona: {
        type: "object",
        description: "Who the brand is and who it speaks to.",
        properties: {
          archetype: { type: "string", description: "Brand archetype / role, e.g. \"Trusted Guide\", \"Energetic Coach\". A short noun phrase." },
          audience: { type: "string", description: "The primary target audience, e.g. \"early-stage founders\". A short noun phrase." },
          mission: { type: "string", description: "One sentence: how the brand helps its audience. \"We help <audience> <benefit> by <how>.\"" },
          values: { type: "array", items: { type: "string" }, description: "Up to 3 core values as single words or short phrases." },
        },
        required: ["archetype", "audience", "mission", "values"],
      },
      dimensions: {
        type: "object",
        description: "Where the voice sits on each of the four tone dimensions.",
        properties: {
          humor: { type: "string", enum: dimEnum("humor") },
          formality: { type: "string", enum: dimEnum("formality") },
          respectfulness: { type: "string", enum: dimEnum("respectfulness") },
          enthusiasm: { type: "string", enum: dimEnum("enthusiasm") },
        },
        required: ["humor", "formality", "respectfulness", "enthusiasm"],
      },
      matrix: {
        type: "array",
        description: "Up to 3 defining traits, each with what it means, where the line is, and a do/don't example.",
        items: {
          type: "object",
          properties: {
            trait: { type: "string", description: "The trait, e.g. \"Confident\"." },
            weAre: { type: "string", description: "What the trait means for this brand. Short." },
            weAreNot: { type: "string", description: "Where to draw the line — the trait taken too far." },
            doEx: { type: "string", description: "A short line the brand would write." },
            dontEx: { type: "string", description: "A short line the brand would NOT write." },
          },
          required: ["trait", "weAre", "weAreNot", "doEx", "dontEx"],
        },
      },
      vocab: {
        type: "object",
        description: "Vocabulary and grammar rules.",
        properties: {
          love: { type: "array", items: { type: "string" }, description: "Up to 6 words/phrases the brand favours." },
          avoid: { type: "array", items: { type: "string" }, description: "Up to 6 words/phrases the brand avoids." },
          contractions: { type: "string", enum: GRAMMAR.contractions as unknown as string[] },
          emojis: { type: "string", enum: GRAMMAR.emojis as unknown as string[] },
          exclamations: { type: "string", enum: GRAMMAR.exclamations as unknown as string[], description: "Whether exclamation marks are used." },
          casing: { type: "string", enum: GRAMMAR.casing as unknown as string[] },
        },
        required: ["love", "avoid", "contractions", "emojis", "exclamations", "casing"],
      },
      summary: { type: "string", description: "One or two sentences describing the voice in plain language." },
    },
    required: ["persona", "dimensions", "matrix", "vocab", "summary"],
  },
};

function dimLines(): string {
  return DIMENSIONS.map((d) => `- ${d.key}: ${d.options.join(" · ")}`).join("\n");
}

function buildPrompt(samples: { label: string; text: string }[]): string {
  const body = samples
    .map((s, i) => `--- SAMPLE ${i + 1} (${s.label}) ---\n${s.text}`)
    .join("\n\n");
  return (
    `You are drafting a Brand Tone of Voice Guide from real writing samples. ` +
    `Read the samples below and infer how this brand actually sounds — judge from the prose ` +
    `itself: register, humour, warmth, energy, sentence shape, punctuation and word choice.\n\n` +
    `Fill in four parts:\n\n` +
    `1. PERSONA — the brand archetype (a role like "Trusted Guide"), the primary audience it ` +
    `speaks to, a one-line mission ("We help <audience> <benefit> by <how>"), and up to 3 core values.\n\n` +
    `2. THE 4 DIMENSIONS — pick exactly one setting for each, from the allowed values:\n${dimLines()}\n\n` +
    `3. TONE MATRIX — up to 3 defining traits. For each: what it means for this brand (We Are), ` +
    `where the line is (We Are NOT), one short line they WOULD write, and one they would NOT.\n\n` +
    `4. VOCABULARY — words/phrases the brand loves and avoids, plus grammar rules ` +
    `(contractions, emoji use, exclamation marks, casing).\n\n` +
    `Base every field on evidence in the samples; don't invent a brand that isn't there. ` +
    `Then call report_voice.\n\n` +
    `WRITING SAMPLES:\n\n${body}`
  );
}

export async function analyzeWithClaude(
  samples: { label: string; text: string }[],
): Promise<AnalysisResult> {
  const client = new Anthropic({ apiKey: env.anthropicKey });
  try {
    const res = await client.messages.create({
      model: env.model,
      max_tokens: 1500,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: "report_voice" },
      messages: [{ role: "user", content: buildPrompt(samples) }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") {
      return sanitizeAnalysis(block.input as Record<string, unknown>);
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
