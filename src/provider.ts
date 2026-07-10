// Pick the analysis backend based on config, and expose a single analyze() the
// server calls without caring which is active.
import { activeMode } from "./env.ts";
import { analyzeWithClaude } from "./anthropic.ts";
import { analyzeHeuristic } from "./demo.ts";
import type { AnalysisResult } from "./types.ts";

export function currentMode(): "live" | "demo" {
  return activeMode();
}

export async function analyzeSamples(
  samples: { label: string; text: string }[],
): Promise<AnalysisResult> {
  if (currentMode() === "live") {
    return analyzeWithClaude(samples);
  }
  const combined = samples.map((s) => s.text).join("\n\n");
  return analyzeHeuristic(combined);
}
