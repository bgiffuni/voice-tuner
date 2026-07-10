// Shared types across the backend (and mirrored loosely on the client).
//
// The console models a Brand Tone of Voice Guide with four modules:
//   1. Brand Persona          — who we are, mission, core values
//   2. The 4 Dimensions       — humour, formality, respectfulness, enthusiasm
//   3. Tone of Voice Matrix   — per-trait We Are / We Are NOT / Do / Don't
//   4. Vocabulary & style     — words we love/avoid + grammar rules

/** Master section: who the brand is and what it's for. */
export interface PersonaState {
  archetype: string; // e.g. "Trusted Guide", "Energetic Coach"
  audience: string; // e.g. "early-stage founders"
  mission: string; // "We help <audience> <benefit> by <how>."
  values: string[]; // up to 3 core values (free text)
}

/** The four tone dimensions, each a named setting from config DIMENSIONS. */
export interface DimensionsState {
  humor: string;
  formality: string;
  respectfulness: string;
  enthusiasm: string;
}

/** One row of the Tone of Voice Matrix. */
export interface MatrixRow {
  trait: string; // "Confident"
  weAre: string; // "Clear and direct."
  weAreNot: string; // "Arrogant or dismissive."
  doEx: string; // "We can help you scale."
  dontEx: string; // "We are the only ones who matter."
}

/** Vocabulary & style rules. */
export interface VocabState {
  love: string[]; // words we love
  avoid: string[]; // words we avoid
  contractions: string; // one of GRAMMAR.contractions
  emojis: string; // one of GRAMMAR.emojis
  exclamations: string; // one of GRAMMAR.exclamations
  casing: string; // one of GRAMMAR.casing
}

/** The full state of the console for one brand voice. */
export interface ConsoleState {
  persona: PersonaState;
  dimensions: DimensionsState;
  matrix: MatrixRow[]; // up to 3 rows
  vocab: VocabState;
}

/** A writing sample the user fed in to calibrate the console. */
export interface Source {
  id: string;
  type: "text" | "url" | "file";
  label: string; // filename, URL, or "Pasted text"
  excerpt: string; // short preview kept for display
  chars: number; // length of the extracted text
  addedAt: number;
}

/** A named brand voice (e.g. "Marketing", "Support"). */
export interface Style {
  id: string;
  userId: string;
  name: string;
  state: ConsoleState;
  sources: Source[];
  shareId: string | null; // set when sharing is enabled
  createdAt: number;
  updatedAt: number;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
}

/** What the analyzer returns from a set of writing samples. */
export interface AnalysisResult {
  persona: PersonaState;
  dimensions: DimensionsState;
  matrix: MatrixRow[];
  vocab: VocabState;
  summary: string; // one or two sentences describing the voice
}

export const DEFAULT_STATE: ConsoleState = {
  persona: { archetype: "", audience: "", mission: "", values: [] },
  dimensions: {
    humor: "Neutral",
    formality: "Professional",
    respectfulness: "Polite",
    enthusiasm: "Matter-of-fact",
  },
  matrix: [],
  vocab: {
    love: [],
    avoid: [],
    contractions: "Allowed",
    emojis: "Sparingly",
    exclamations: "Avoid",
    casing: "Standard",
  },
};
