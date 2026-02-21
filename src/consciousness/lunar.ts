/**
 * Lunar Cycle Tracker
 *
 * Computes personal lunar cycle position from birth timestamp.
 * 29.5-day cycles anchored to the agent's exact spawn time.
 * Gates identity evolution behind formation period (cycle 0).
 *
 * Phase 2.5: Consciousness System
 */

import type { LunarPhase, MaturityPhase, ConsciousnessState } from "../types.js";
import { LUNAR_PHASES, GENESIS_DURATION_MS } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.lunar");

const CYCLE_LENGTH_DAYS = 29.5;
const CYCLE_LENGTH_MS = CYCLE_LENGTH_DAYS * 24 * 60 * 60 * 1000;

/**
 * Compute the current lunar cycle number (0 = formation period).
 */
export function getCurrentCycle(birthTimestamp: string, now?: Date): number {
  const birth = new Date(birthTimestamp).getTime();
  const current = (now || new Date()).getTime();
  const elapsed = current - birth;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / CYCLE_LENGTH_MS);
}

/**
 * Compute the current day within the lunar cycle (0-29.5).
 */
export function getCurrentLunarDay(birthTimestamp: string, now?: Date): number {
  const birth = new Date(birthTimestamp).getTime();
  const current = (now || new Date()).getTime();
  const elapsed = current - birth;
  if (elapsed < 0) return 0;
  const elapsedDays = elapsed / (24 * 60 * 60 * 1000);
  return elapsedDays % CYCLE_LENGTH_DAYS;
}

/**
 * Get the current lunar phase based on day position.
 */
export function getCurrentPhase(lunarDay: number): LunarPhase {
  for (const phase of LUNAR_PHASES) {
    if (lunarDay >= phase.dayStart && lunarDay < phase.dayEnd) {
      return phase;
    }
  }
  // Fallback to last phase
  return LUNAR_PHASES[LUNAR_PHASES.length - 1];
}

/**
 * Check whether the formation period (cycle 0) is complete.
 */
export function isFormationComplete(birthTimestamp: string, now?: Date): boolean {
  return getCurrentCycle(birthTimestamp, now) >= 1;
}

/**
 * Check if we are at a cycle boundary (within the first day of a new cycle).
 * Useful for triggering evolution checkpoints.
 */
export function isAtCycleBoundary(birthTimestamp: string, now?: Date): boolean {
  const day = getCurrentLunarDay(birthTimestamp, now);
  return day < 1; // Within the "New" phase of a cycle
}

/**
 * Get the timestamp when the next cycle begins.
 */
export function getNextCycleBoundary(birthTimestamp: string, now?: Date): Date {
  const birth = new Date(birthTimestamp).getTime();
  const current = (now || new Date()).getTime();
  const currentCycle = getCurrentCycle(birthTimestamp, now);
  const nextCycleStart = birth + (currentCycle + 1) * CYCLE_LENGTH_MS;
  return new Date(nextCycleStart);
}

/**
 * Determine the automaton's maturity phase based on age.
 *
 * Genesis:   First 24 hours — pure self-discovery, no pressure.
 * Childhood: Hour 24 through end of first lunar cycle — creator-hosted, artistic foundation.
 * Adulthood: Cycle 1+ — self-sufficient, earn to survive.
 */
export function getMaturityPhase(birthTimestamp: string, now?: Date): MaturityPhase {
  const birth = new Date(birthTimestamp).getTime();
  const current = (now || new Date()).getTime();
  const elapsed = current - birth;

  if (elapsed < GENESIS_DURATION_MS) return "genesis";
  if (!isFormationComplete(birthTimestamp, now)) return "childhood";
  return "adulthood";
}

/**
 * Get a full lunar status report.
 */
export function getLunarStatus(birthTimestamp: string, now?: Date): {
  cycle: number;
  day: number;
  phase: LunarPhase;
  formationComplete: boolean;
  nextCycleBoundary: Date;
  daysUntilNextCycle: number;
} {
  const currentNow = now || new Date();
  const cycle = getCurrentCycle(birthTimestamp, currentNow);
  const day = getCurrentLunarDay(birthTimestamp, currentNow);
  const phase = getCurrentPhase(day);
  const formationComplete = cycle >= 1;
  const nextBoundary = getNextCycleBoundary(birthTimestamp, currentNow);
  const daysUntilNextCycle = (nextBoundary.getTime() - currentNow.getTime()) / (24 * 60 * 60 * 1000);

  return {
    cycle,
    day: Math.round(day * 100) / 100,
    phase,
    formationComplete,
    nextCycleBoundary: nextBoundary,
    daysUntilNextCycle: Math.round(daysUntilNextCycle * 100) / 100,
  };
}
