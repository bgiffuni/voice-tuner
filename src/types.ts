// Shared types across the backend (and mirrored loosely on the client).

/** The four console faders, each 0–100. */
export interface Faders {
  tech: number;
  wit: number;
  formality: number;
  pace: number;
}

/** The full state of the mixing console for one style. */
export interface ConsoleState {
  adjectives: string[]; // up to 3 identity words
  tech: number;
  wit: number;
  formality: number;
  pace: number;
  mutes: string[]; // keys into config MUTES
  solos: string[]; // keys into config SOLOS
  routes: string[]; // route labels
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

/** A named writing style (e.g. "Professional", "Personal"). */
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
  adjectives: string[];
  tech: number;
  wit: number;
  formality: number;
  pace: number;
  mutes: string[];
  solos: string[];
  summary: string; // one or two sentences describing the voice
}

export const DEFAULT_STATE: ConsoleState = {
  adjectives: [],
  tech: 50,
  wit: 50,
  formality: 50,
  pace: 50,
  mutes: [],
  solos: [],
  routes: [],
};
