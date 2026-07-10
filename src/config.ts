// The console's vocabulary lives here (not hardcoded in the UI), so it can be
// edited in one place and is served to the client via GET /api/config. The
// analyzer and demo generator also reference these keys.

export const ADJECTIVES = [
  "Friendly", "Analytical", "Bold", "Playful", "Precise", "Empathetic",
  "Direct", "Curious", "Confident", "Pragmatic", "Storyteller", "Calm",
  "Energetic", "Meticulous", "Irreverent", "Grounded",
];

export interface FaderDef {
  key: "tech" | "wit" | "formality" | "pace";
  label: string; // short console label (may contain \n)
  low: string;
  high: string;
}

export const FADERS: FaderDef[] = [
  { key: "tech", label: "TECH\nDEPTH", low: "Plain\nlanguage", high: "Full\ndepth" },
  { key: "wit", label: "WIT", low: "Straight-\nforward", high: "Playful\n& bold" },
  { key: "formality", label: "FORMAL-\nITY", low: "Casual", high: "Formal &\npolished" },
  { key: "pace", label: "PACE", low: "Detailed &\nthorough", high: "Tight &\nconcise" },
];

export interface ToggleDef {
  key: string;
  label: string;
  text: string;
}

export const MUTES: ToggleDef[] = [
  { key: "jargon", label: "Jargon without translation", text: "Technical terms dropped in without a plain-language translation or a reason to be there." },
  { key: "padding", label: "Padding & filler", text: "Content that pads length without adding anything the reader actually needed." },
  { key: "formulaic", label: "Formulaic structure", text: "The same opening and closing move on every piece — structure should be earned, not templated." },
  { key: "emdash", label: "Excessive em-dashes", text: "Em-dashes used as a tic rather than for a genuine interruption or aside." },
  { key: "hedging", label: "Hedging language", text: "Hedge words like \"I think\" or \"maybe\" standing in where a direct claim would do." },
  { key: "hype", label: "Exclamation-point energy", text: "Exclamation points and forced enthusiasm standing in for real warmth." },
  { key: "passive", label: "Passive voice", text: "Passive constructions that obscure who's actually doing what." },
  { key: "cliche", label: "Clichés & buzzwords", text: "Recycled industry buzzwords doing the work a real sentence should do." },
];

export const SOLOS: ToggleDef[] = [
  { key: "clarity", label: "Clarity & concision", text: "Being clear and concise, even when the underlying idea is genuinely complex." },
  { key: "warmth", label: "Warmth & approachability", text: "Being read as warm and approachable — this matters more than sounding impressive." },
  { key: "versatility", label: "Technical versatility", text: "Dialing technical depth up or down depending on who's actually reading." },
  { key: "experience", label: "Storytelling from experience", text: "Speaking from real, lived experience rather than general theory." },
  { key: "voice", label: "Distinct personal voice", text: "Sounding recognizably like one specific person, not generic, interchangeable writing." },
  { key: "humor", label: "Humor & wit", text: "Being genuinely sharp or funny when the moment allows it." },
  { key: "authority", label: "Confidence & authority", text: "Sounding sure of the claims being made, without hedging." },
];

export const ROUTES = [
  "Marketing content", "Client communications", "Business proposals",
  "Social media", "Internal docs & reports",
];

export const MUTE_KEYS = new Set(MUTES.map((m) => m.key));
export const SOLO_KEYS = new Set(SOLOS.map((s) => s.key));
export const ADJECTIVE_SET = new Set(ADJECTIVES);

export function configPayload() {
  return { ADJECTIVES, FADERS, MUTES, SOLOS, ROUTES };
}
