// The console's vocabulary lives here (not hardcoded in the UI), so it can be
// edited in one place and is served to the client via GET /api/config. The
// analyzer and demo generator also reference these keys.
//
// The console models a Brand Tone of Voice Guide:
//   1. Persona  2. The 4 Dimensions  3. Tone Matrix  4. Vocabulary & style.

// ---- 2. The 4 Dimensions of Tone ------------------------------------------
// Each dimension is a stepped fader: options are ordered low → high, i.e.
// options[0] sits at the bottom of the fader, options[last] at the top.

export interface DimensionDef {
  key: "humor" | "formality" | "respectfulness" | "enthusiasm";
  label: string; // short scribble-strip label
  options: string[]; // ordered low → high
  lowHint: string; // caption for the bottom of the fader
  highHint: string; // caption for the top of the fader
}

export const DIMENSIONS: DimensionDef[] = [
  {
    key: "humor",
    label: "HUMOR",
    options: ["Serious", "Dry", "Neutral", "Playful", "Funny"],
    lowHint: "Serious",
    highHint: "Funny",
  },
  {
    key: "formality",
    label: "FORMAL-\nITY",
    options: ["Colloquial", "Casual", "Professional", "Formal"],
    lowHint: "Colloquial",
    highHint: "Formal",
  },
  {
    key: "respectfulness",
    label: "RESPECT",
    options: ["Irreverent", "Neutral", "Polite", "Respectful"],
    lowHint: "Irreverent",
    highHint: "Respectful",
  },
  {
    key: "enthusiasm",
    label: "ENERGY",
    options: ["Low-key", "Matter-of-fact", "Enthusiastic", "High"],
    lowHint: "Low-key",
    highHint: "High",
  },
];

// ---- 4. Vocabulary & Style Rules — grammar switches -----------------------

export const GRAMMAR = {
  contractions: ["Allowed", "Forbidden"],
  emojis: ["Never", "Sparingly", "Often"],
  exclamations: ["Avoid", "Allowed"],
  casing: ["Standard", "Flexible"],
} as const;

// ---- Suggestion pools (free text is allowed; these are just chips) ---------

/** Suggested archetypes for the persona (free text still allowed). */
export const ARCHETYPES = [
  "Trusted Guide", "Energetic Coach", "Innovative Rebel", "Steady Expert",
  "Friendly Insider", "Bold Challenger", "Calm Reassurer", "Witty Companion",
];

/** Suggested core values (free text still allowed). */
export const VALUE_POOL = [
  "Clarity", "Honesty", "Craft", "Curiosity", "Empathy", "Boldness",
  "Reliability", "Simplicity", "Momentum", "Rigor",
];

/** Suggested traits for the Tone Matrix rows (free text still allowed). */
export const TRAIT_POOL = [
  "Confident", "Helpful", "Witty", "Direct", "Warm", "Precise",
  "Playful", "Grounded", "Empathetic", "Bold",
];

// ---- Lookups used for validation ------------------------------------------

export const DIMENSION_OPTIONS: Record<string, Set<string>> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.key, new Set(d.options)]),
);

export const GRAMMAR_SETS = {
  contractions: new Set<string>(GRAMMAR.contractions),
  emojis: new Set<string>(GRAMMAR.emojis),
  exclamations: new Set<string>(GRAMMAR.exclamations),
  casing: new Set<string>(GRAMMAR.casing),
};

export function configPayload() {
  return { DIMENSIONS, GRAMMAR, ARCHETYPES, VALUE_POOL, TRAIT_POOL };
}
