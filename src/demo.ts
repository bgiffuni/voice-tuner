// Offline analyzer: estimate a brand tone-of-voice guide from writing samples
// using simple text heuristics, no API key required. Deterministic and fast —
// good enough to demo the whole flow and to fall back on if a live call fails.
//
// Also exports sanitizeAnalysis(), the shared coercion that turns any raw
// object (Claude's tool output, or otherwise) into a valid AnalysisResult.
import type { AnalysisResult, MatrixRow } from "./types.ts";
import { DIMENSIONS, DIMENSION_OPTIONS, GRAMMAR_SETS, GRAMMAR } from "./config.ts";
import { DEFAULT_STATE } from "./types.ts";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const HEDGES = /\b(i think|maybe|perhaps|sort of|kind of|possibly|probably|it seems|arguably|i guess|might be)\b/gi;
const BUZZWORDS = /\b(synergy|leverage|paradigm|disrupt|holistic|robust|seamless|cutting-edge|best-in-class|game-changer|circle back|move the needle|low-hanging fruit|deep dive)\b/gi;
const HUMOR = /\b(honestly|frankly|look|basically|obviously|spoiler|plot twist|lol|haha)\b/gi;
const CONTRACTIONS = /\b(\w+'(t|s|re|ve|ll|d|m))\b/gi;
const POLITE = /\b(please|thank you|thanks|appreciate|kindly|we'd love|happy to)\b/gi;

function count(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

// ---- Coercion shared by both analyzers ------------------------------------

function str(v: unknown, max = 240): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function strArr(v: unknown, maxItems: number, maxLen = 60): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function pickOption(key: string, v: unknown): string {
  const set = DIMENSION_OPTIONS[key];
  const s = str(v, 40);
  if (set && set.has(s)) return s;
  return (DEFAULT_STATE.dimensions as unknown as Record<string, string>)[key];
}

function pickGrammar(kind: keyof typeof GRAMMAR_SETS, v: unknown): string {
  const s = str(v, 20);
  if (GRAMMAR_SETS[kind].has(s)) return s;
  return (DEFAULT_STATE.vocab as unknown as Record<string, string>)[kind];
}

function coerceMatrix(v: unknown): MatrixRow[] {
  if (!Array.isArray(v)) return [];
  const out: MatrixRow[] = [];
  for (const raw of v) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const trait = str(o.trait, 40);
    if (!trait) continue;
    out.push({
      trait,
      weAre: str(o.weAre, 200),
      weAreNot: str(o.weAreNot, 200),
      doEx: str(o.doEx, 200),
      dontEx: str(o.dontEx, 200),
    });
    if (out.length >= 3) break;
  }
  return out;
}

export function sanitizeAnalysis(input: Record<string, unknown>): AnalysisResult {
  const p = (input.persona ?? {}) as Record<string, unknown>;
  const d = (input.dimensions ?? {}) as Record<string, unknown>;
  const vo = (input.vocab ?? {}) as Record<string, unknown>;
  return {
    persona: {
      archetype: str(p.archetype, 80),
      audience: str(p.audience, 120),
      mission: str(p.mission, 240),
      values: strArr(p.values, 3, 40),
    },
    dimensions: {
      humor: pickOption("humor", d.humor),
      formality: pickOption("formality", d.formality),
      respectfulness: pickOption("respectfulness", d.respectfulness),
      enthusiasm: pickOption("enthusiasm", d.enthusiasm),
    },
    matrix: coerceMatrix(input.matrix),
    vocab: {
      love: strArr(vo.love, 6, 40),
      avoid: strArr(vo.avoid, 6, 40),
      contractions: pickGrammar("contractions", vo.contractions),
      emojis: pickGrammar("emojis", vo.emojis),
      exclamations: pickGrammar("exclamations", vo.exclamations),
      casing: pickGrammar("casing", vo.casing),
    },
    summary: str(input.summary, 400),
  };
}

// ---- Offline heuristic ----------------------------------------------------

const opt = (key: string, i: number) => {
  const options = DIMENSIONS.find((x) => x.key === key)!.options;
  return options[Math.max(0, Math.min(options.length - 1, i))];
};

export function analyzeHeuristic(text: string): AnalysisResult {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  const avgSentenceLen = wordCount / sentenceCount;
  const per1k = (n: number) => (n / wordCount) * 1000;

  const exclamations = count(text, /!/g);
  const questions = count(text, /\?/g);
  const hedges = count(text, HEDGES);
  const buzz = count(text, BUZZWORDS);
  const humor = count(text, HUMOR);
  const contractions = count(text, CONTRACTIONS);
  const polite = count(text, POLITE);

  // Dimensions → named settings.
  const humorScore = clamp(30 + per1k(humor) * 8 + per1k(exclamations) * 4);
  const formalityScore = clamp(70 - per1k(contractions) * 5 - per1k(humor) * 4 - per1k(exclamations) * 4);
  const energyScore = clamp(25 + per1k(exclamations) * 10 + per1k(humor) * 5);

  const dimensions = {
    // 5 steps: Serious(0) … Funny(4)
    humor: opt("humor", Math.round((humorScore / 100) * 4)),
    // 4 steps: Colloquial(0) … Formal(3)
    formality: opt("formality", Math.round((formalityScore / 100) * 3)),
    // 4 steps: Irreverent(0) … Respectful(3)
    respectfulness: opt(
      "respectfulness",
      polite > 1 ? 3 : humorScore > 60 && formalityScore < 45 ? 1 : 2,
    ),
    // 4 steps: Low-key(0) … High(3)
    enthusiasm: opt("enthusiasm", Math.round((energyScore / 100) * 3)),
  };

  // Vocabulary rules.
  const avoid = [...new Set((text.match(BUZZWORDS) || []).map((w) => w.toLowerCase()))].slice(0, 6);
  const vocab = {
    love: [] as string[],
    avoid,
    contractions: contractions > 1 ? "Allowed" : "Forbidden",
    emojis: GRAMMAR.emojis[1], // "Sparingly" — can't reliably detect from text
    exclamations: per1k(exclamations) > 4 ? "Allowed" : "Avoid",
    casing: "Standard",
  };

  // One or two matrix rows derived from the dominant characteristics.
  const matrix: MatrixRow[] = [];
  matrix.push(
    avgSentenceLen < 16
      ? { trait: "Clear", weAre: "Plain and direct — easy to follow on the first read.", weAreNot: "Blunt or oversimplified.", doEx: "Here's what changed and why.", dontEx: "Pursuant to the aforementioned modifications…" }
      : { trait: "Thorough", weAre: "We give ideas the room they need to land.", weAreNot: "Rambling or padded.", doEx: "Let's walk through how this works, step by step.", dontEx: "It just works, trust us." },
  );
  if (humorScore > 55) {
    matrix.push({ trait: "Playful", weAre: "Light and human, with a bit of wit.", weAreNot: "Goofy or flippant about serious things.", doEx: "Less busywork. More actual work.", dontEx: "Paperwork makes us cry lol." });
  } else if (formalityScore > 65) {
    matrix.push({ trait: "Composed", weAre: "Measured and considered.", weAreNot: "Stiff or distant.", doEx: "We recommend a measured rollout.", dontEx: "YOLO, ship it." });
  }

  const summary =
    `Estimated offline from ${wordCount.toLocaleString()} words: ` +
    `${dimensions.formality.toLowerCase()} register, ` +
    `${dimensions.humor.toLowerCase()} humour, ` +
    `${dimensions.enthusiasm.toLowerCase()} energy. ` +
    `Persona fields are left for you to fill in — the offline analyzer can't infer your brand.`;

  return {
    persona: { archetype: "", audience: "", mission: "", values: [] },
    dimensions,
    matrix,
    vocab,
    summary,
  };
}
