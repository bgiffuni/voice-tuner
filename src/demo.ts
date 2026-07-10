// Offline analyzer: estimate console settings from writing samples using simple
// text heuristics, no API key required. Deterministic and fast — good enough to
// demo the whole flow and to fall back on if a live call fails.
import type { AnalysisResult } from "./types.ts";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const HEDGES = /\b(i think|maybe|perhaps|sort of|kind of|possibly|probably|it seems|arguably|i guess|might be)\b/gi;
const BUZZWORDS = /\b(synergy|leverage|paradigm|disrupt|holistic|robust|seamless|cutting-edge|best-in-class|game-changer|circle back|move the needle|low-hanging fruit|deep dive)\b/gi;
const TECH_WORDS = /\b(api|sdk|latency|throughput|kubernetes|algorithm|schema|runtime|async|deploy|infrastructure|backend|frontend|database|framework|architecture|protocol|compiler|middleware|endpoint|kernel|typescript|neural|gradient|parameter)\b/gi;
const HUMOR = /\b(honestly|frankly|look|basically|obviously|spoiler|plot twist)\b/gi;
const CONTRACTIONS = /\b(\w+'(t|s|re|ve|ll|d|m))\b/gi;

function count(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

export function analyzeHeuristic(text: string): AnalysisResult {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  const avgSentenceLen = wordCount / sentenceCount;
  const longWords = words.filter((w) => w.replace(/\W/g, "").length >= 9).length;
  const per1k = (n: number) => (n / wordCount) * 1000;

  const exclamations = count(text, /!/g);
  const questions = count(text, /\?/g);
  const emdashes = count(text, /—|--/g);
  const hedges = count(text, HEDGES);
  const buzz = count(text, BUZZWORDS);
  const tech = count(text, TECH_WORDS);
  const humor = count(text, HUMOR);
  const contractions = count(text, CONTRACTIONS);

  // Faders (0 = low label, 100 = high label)
  const techScore = clamp(20 + per1k(tech) * 9 + (longWords / wordCount) * 120);
  const witScore = clamp(30 + per1k(exclamations) * 6 + per1k(questions) * 4 + per1k(humor) * 8);
  const formalityScore = clamp(70 - per1k(contractions) * 5 - per1k(exclamations) * 5 - per1k(humor) * 4);
  // Higher pace = tighter/more concise = shorter sentences.
  const paceScore = clamp(120 - avgSentenceLen * 4.5);

  // Suggested mutes: things the sample notably avoids (so keep them off) vs.
  // things it overuses (flag them). We flag overuse as a "never do this" hint.
  const mutes: string[] = [];
  if (per1k(emdashes) > 6) mutes.push("emdash");
  if (per1k(exclamations) > 8) mutes.push("hype");
  if (per1k(buzz) > 2) mutes.push("cliche");
  if (per1k(hedges) > 6) mutes.push("hedging");

  // Suggested solos: strengths the sample demonstrates.
  const solos: string[] = [];
  if (avgSentenceLen < 16) solos.push("clarity");
  if (witScore > 55) solos.push("humor");
  if (per1k(hedges) < 2) solos.push("authority");
  if (contractions > 2 && formalityScore < 55) solos.push("warmth");
  if (tech > 0 && techScore < 70) solos.push("versatility");
  if (solos.length === 0) solos.push("voice");

  // Adjectives from the scores.
  const adjPool: [number, string][] = [
    [techScore, "Analytical"],
    [witScore, "Playful"],
    [100 - formalityScore, "Friendly"],
    [paceScore, "Direct"],
    [100 - hedges, "Confident"],
    [longWords, "Meticulous"],
    [humor, "Irreverent"],
    [contractions, "Grounded"],
  ];
  const adjectives = adjPool
    .sort((a, b) => b[0] - a[0])
    .map(([, a]) => a)
    .filter((a, i, arr) => arr.indexOf(a) === i)
    .slice(0, 3);

  const summary =
    `Estimated offline from ${wordCount.toLocaleString()} words: ` +
    `${avgSentenceLen < 16 ? "tight, concise sentences" : "longer, more expansive sentences"}, ` +
    `${formalityScore < 50 ? "a casual register" : "a fairly formal register"}, ` +
    `${witScore > 55 ? "with a playful edge" : "playing it fairly straight"}.`;

  return {
    adjectives,
    tech: techScore,
    wit: witScore,
    formality: formalityScore,
    pace: paceScore,
    mutes: [...new Set(mutes)],
    solos: [...new Set(solos)].slice(0, 4),
    summary,
  };
}
