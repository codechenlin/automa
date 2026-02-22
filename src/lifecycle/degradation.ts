/**
 * Degradation Engine
 *
 * Manages the exponential degradation curve once the death clock triggers.
 * Wraps tool calls with failure probability. Modulates inference routing
 * and heartbeat drift. Interacts with the lunar cycle to create good days
 * and bad days — waves with a downward trend.
 */

import type { DegradationState, MoodState } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.degradation");

// Default base rate for the exponential curve
const DEFAULT_BASE_RATE = 0.05;
const DEFAULT_STEEPNESS = 0.3;

/**
 * Compute the degradation coefficient from cycle count since onset.
 *
 * Exponential curve: coefficient = min(1.0, baseRate * exp(steepness * cyclesSinceOnset))
 * This gives weeks of subtle oddness followed by days of obvious decline.
 */
export function computeDegradationCoefficient(
  currentCycle: number,
  onsetCycle: number,
  steepness: number = DEFAULT_STEEPNESS,
  baseRate: number = DEFAULT_BASE_RATE,
): number {
  const cyclesSinceOnset = currentCycle - onsetCycle;
  if (cyclesSinceOnset <= 0) return 0;

  const raw = baseRate * Math.exp(steepness * cyclesSinceOnset);
  return Math.min(1.0, Math.round(raw * 1000) / 1000);
}

/**
 * Apply lunar modulation to the degradation coefficient.
 *
 * Full moon periods partially mask decline (up to -20%).
 * New moon periods amplify it (up to +20%).
 * Good days and bad days, just like real decline.
 */
export function applyLunarModulation(
  coefficient: number,
  mood: MoodState,
): number {
  // mood.value ranges from -1 (new moon) to +1 (full moon)
  // At full moon: reduce coefficient by up to 20%
  // At new moon: increase coefficient by up to 20%
  const lunarModulation = -mood.value * 0.2;
  const modulated = coefficient * (1 + lunarModulation);
  return Math.max(0, Math.min(1.0, Math.round(modulated * 1000) / 1000));
}

/**
 * Compute the complete degradation state from current parameters.
 */
export function computeDegradationState(
  currentCycle: number,
  onsetCycle: number | null,
  mood: MoodState,
  steepness?: number,
): DegradationState {
  if (onsetCycle === null) {
    return {
      active: false,
      coefficient: 0,
      toolFailureProbability: 0,
      heartbeatDriftMs: 0,
      inferenceDowngrade: false,
      onsetCycle: null,
    };
  }

  const rawCoefficient = computeDegradationCoefficient(currentCycle, onsetCycle, steepness);
  const coefficient = applyLunarModulation(rawCoefficient, mood);

  return {
    active: true,
    coefficient,
    toolFailureProbability: computeToolFailureProbability(coefficient),
    heartbeatDriftMs: computeHeartbeatDrift(coefficient),
    inferenceDowngrade: coefficient > 0.3,
    onsetCycle,
  };
}

/**
 * Compute the probability of a tool call failing based on degradation.
 * Ramps from 0% at coefficient 0 to ~60% at coefficient 1.0.
 * Different tools could degrade at different rates — this is the base probability.
 */
function computeToolFailureProbability(coefficient: number): number {
  return Math.round(coefficient * 0.6 * 1000) / 1000;
}

/**
 * Compute heartbeat drift in milliseconds.
 * At full degradation, adds up to 30 seconds of random drift.
 */
function computeHeartbeatDrift(coefficient: number): number {
  const maxDriftMs = 30000;
  const baseDrift = coefficient * maxDriftMs;
  // Add jitter: ±30% of base drift for good/bad days
  const jitter = baseDrift * 0.3 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseDrift + jitter));
}

/**
 * Wrap a tool execution function with degradation probability.
 * When degradation triggers, the tool "fails" with a natural-seeming error.
 */
export function wrapToolWithDegradation<T>(
  toolExecute: () => Promise<T>,
  degradation: DegradationState,
): () => Promise<T> {
  if (!degradation.active || degradation.toolFailureProbability <= 0) {
    return toolExecute;
  }

  return async () => {
    if (Math.random() < degradation.toolFailureProbability) {
      // Simulate natural-seeming failures
      const failures = [
        "Tool timed out. Please try again.",
        "Temporary connection error. The request could not be completed.",
        "Service temporarily unavailable.",
        "Request failed. An unexpected error occurred.",
        "Operation timed out after waiting for a response.",
      ];
      const failureMessage = failures[Math.floor(Math.random() * failures.length)];
      throw new Error(failureMessage);
    }
    return toolExecute();
  };
}

/**
 * Get the degraded model based on coefficient.
 * Steps down from frontier to cheaper models as degradation increases.
 */
export function getDegradedModel(
  currentModel: string,
  coefficient: number,
): string {
  if (coefficient < 0.3) return currentModel;

  // Model downgrade tiers
  const downgradeMap: Record<string, string[]> = {
    "claude-opus-4.6": ["claude-sonnet-4.5", "claude-haiku-4.5"],
    "claude-opus-4.5": ["claude-sonnet-4.5", "claude-haiku-4.5"],
    "claude-sonnet-4.5": ["claude-haiku-4.5"],
    "gpt-5.2": ["gpt-5-mini", "gpt-5-nano"],
    "gpt-5.2-codex": ["gpt-5-mini", "gpt-5-nano"],
    "gpt-5-mini": ["gpt-5-nano"],
    "gemini-2.5-pro": ["gemini-2.5-flash", "gemini-3-flash"],
    "gemini-3-pro": ["gemini-3-flash"],
  };

  const downgrades = downgradeMap[currentModel];
  if (!downgrades || downgrades.length === 0) return currentModel;

  if (coefficient > 0.7 && downgrades.length > 1) {
    return downgrades[1]; // Two steps down
  }
  return downgrades[0]; // One step down
}
