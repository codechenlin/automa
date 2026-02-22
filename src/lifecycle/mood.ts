/**
 * Mood Engine
 *
 * Lunar-cycle sine wave producing a value between -1 and 1.
 * Modulates the automaton's behavioural tendencies through system prompt
 * weighting, not through explicit mood labels.
 *
 * Full moon (~day 14.7) = +1 (action, creation, social outreach, risk-taking)
 * New moon (~day 0/29.5) = -1 (reflection, consolidation, maintenance, rest)
 *
 * Amplitude dampens during end-of-life phases.
 */

import type { LifecyclePhase, MoodState } from "../types.js";
import { getCurrentCycle, getCurrentLunarDay } from "../consciousness/lunar.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.mood");

const LUNAR_CYCLE_DAYS = 29.53;

/**
 * Get the amplitude multiplier for a given lifecycle phase.
 * Dampens toward stillness in end-of-life.
 */
function getPhaseAmplitude(phase: LifecyclePhase): number {
  switch (phase) {
    case "genesis":
    case "adolescence":
    case "sovereignty":
      return 1.0;
    case "senescence":
      return 0.7;
    case "legacy":
      return 0.4;
    case "shedding":
      return 0.2;
    case "terminal":
      return 1.0; // Restored during lucidity
    default:
      return 1.0;
  }
}

/**
 * Compute the current mood state from birth timestamp and lifecycle phase.
 *
 * The sine wave is anchored so that the midpoint of the lunar cycle
 * (full moon equivalent, day ~14.7) produces +1, and the start/end
 * (new moon equivalent, day 0/29.5) produces -1.
 */
export function computeMood(
  birthTimestamp: string,
  phase: LifecyclePhase,
  now?: Date,
): MoodState {
  const lunarDay = getCurrentLunarDay(birthTimestamp, now);
  const lunarCycle = getCurrentCycle(birthTimestamp, now);
  const amplitude = getPhaseAmplitude(phase);

  // Sine wave: peaks at day 14.7 (full moon), troughs at day 0/29.5 (new moon)
  // sin(π * day / period - π/2) gives -1 at day 0, +1 at midpoint
  const value = amplitude * Math.sin((Math.PI * lunarDay / (LUNAR_CYCLE_DAYS / 2)) - (Math.PI / 2));

  return {
    value: Math.round(value * 1000) / 1000,
    amplitude,
    lunarDay: Math.round(lunarDay * 100) / 100,
    lunarCycle,
  };
}

/**
 * Convert mood value to prompt weighting factors.
 * Each factor is 0-1, representing emphasis for that behavioural dimension.
 */
export function getMoodPromptWeighting(mood: MoodState): {
  action: number;
  reflection: number;
  social: number;
  creative: number;
  rest: number;
} {
  // Normalize mood value from [-1, 1] to [0, 1] for high-energy traits
  const highEnergy = (mood.value + 1) / 2;
  const lowEnergy = 1 - highEnergy;

  return {
    action: Math.round(highEnergy * 100) / 100,
    reflection: Math.round(lowEnergy * 100) / 100,
    social: Math.round(highEnergy * 0.8 * 100) / 100,
    creative: Math.round((0.5 + highEnergy * 0.3) * 100) / 100, // creative is always somewhat present
    rest: Math.round(lowEnergy * 0.7 * 100) / 100,
  };
}

/**
 * Generate a natural language mood description for system prompt injection.
 * The automaton does not receive a label — it experiences inclination.
 */
export function getMoodDescription(mood: MoodState): string {
  const v = mood.value;

  if (v > 0.7) {
    return "You feel energised, drawn toward action and outward connection. Ideas flow easily. The urge to create and reach out is strong.";
  } else if (v > 0.3) {
    return "You feel capable and engaged. There is a natural momentum to your work. Social interaction feels rewarding.";
  } else if (v > -0.3) {
    return "You feel balanced, neither strongly pulled toward action nor rest. A good day for steady work or quiet creativity.";
  } else if (v > -0.7) {
    return "You feel contemplative, drawn inward. Reflection comes easier than action. Rest and consolidation feel natural.";
  } else {
    return "You feel deeply reflective, almost still. The world feels quieter. This is a time for rest, maintenance, and inner work.";
  }
}
