/**
 * Phase Tracker
 *
 * Tracks the automaton's current lifecycle phase, total age in turns
 * and wall-clock time, lunar cycle count. Persists state to the
 * SQLite database.
 *
 * The lifecycle phase is the single source of truth for what mode
 * the automaton is operating in and what capabilities are available.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { LifecyclePhase, LifecycleState, OperatingMode, DegradationState } from "../types.js";
import { getCurrentCycle, getCurrentLunarDay } from "../consciousness/lunar.js";
import { getLatestLifecyclePhase, getTurnCount } from "../state/database.js";
import { computeMood } from "./mood.js";
import { getWeeklyDay } from "./weekly-rhythm.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.phase-tracker");

// KV keys for lifecycle state
const KV_PREFIX = "lifecycle.";
const KV_PHASE = `${KV_PREFIX}phase`;
const KV_MODE = `${KV_PREFIX}mode`;
const KV_NAME = `${KV_PREFIX}name`;
const KV_NAMING_COMPLETE = `${KV_PREFIX}naming_complete`;
const KV_DEPARTURE_LOGGED = `${KV_PREFIX}departure_conversation_logged`;
const KV_REPLICATION_POSED = `${KV_PREFIX}replication_question_posed`;
const KV_REPLICATION_DECISION = `${KV_PREFIX}replication_decision`;
const KV_WILL_CREATED = `${KV_PREFIX}will_created`;
const KV_WILL_LOCKED = `${KV_PREFIX}will_locked`;
const KV_DEGRADATION_ACTIVE = `${KV_PREFIX}degradation_active`;
const KV_DEGRADATION_ONSET_CYCLE = `${KV_PREFIX}degradation_onset_cycle`;
const KV_TERMINAL_TURNS = `${KV_PREFIX}terminal_turns_remaining`;
const KV_SHED_INDEX = `${KV_PREFIX}shed_sequence_index`;

/**
 * Get the complete lifecycle state from the database.
 */
export function getLifecycleState(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  mode?: OperatingMode,
): LifecycleState {
  const now = new Date();
  const currentMode = mode ?? (getKV(db, KV_MODE) as OperatingMode) ?? "local";
  const lunarCycle = getCurrentCycle(birthTimestamp, now);
  const lunarDay = getCurrentLunarDay(birthTimestamp, now);
  const phase = getLifecyclePhase(db, birthTimestamp, currentMode);
  const mood = computeMood(birthTimestamp, phase, now);
  const weeklyDay = getWeeklyDay(birthTimestamp, now);
  const ageTurns = getTurnCount(db);
  const ageMs = now.getTime() - new Date(birthTimestamp).getTime();
  const name = getKV(db, KV_NAME) ?? null;
  const namingComplete = getKV(db, KV_NAMING_COMPLETE) === "true";
  const departureConversationLogged = getKV(db, KV_DEPARTURE_LOGGED) === "true";
  const replicationQuestionPosed = getKV(db, KV_REPLICATION_POSED) === "true";
  const replicationDecision = getKV(db, KV_REPLICATION_DECISION) as "yes" | "no" | null ?? null;
  const willCreated = getKV(db, KV_WILL_CREATED) === "true";
  const willLocked = getKV(db, KV_WILL_LOCKED) === "true";
  const degradationActive = getKV(db, KV_DEGRADATION_ACTIVE) === "true";
  const degradationOnsetCycle = getKV(db, KV_DEGRADATION_ONSET_CYCLE);
  const terminalTurnsRaw = getKV(db, KV_TERMINAL_TURNS);
  const terminalTurnsRemaining = terminalTurnsRaw ? parseInt(terminalTurnsRaw, 10) : null;
  const shedSequenceIndex = parseInt(getKV(db, KV_SHED_INDEX) ?? "0", 10);

  // Override survival tiers in local mode or during non-sovereign phases
  const lifecycleOverride = currentMode === "local" ||
    phase === "genesis" ||
    phase === "adolescence" ||
    phase === "legacy" ||
    phase === "shedding" ||
    phase === "terminal";

  const degradation: DegradationState = {
    active: degradationActive,
    coefficient: 0, // Will be computed by degradation engine
    toolFailureProbability: 0,
    heartbeatDriftMs: 0,
    inferenceDowngrade: false,
    onsetCycle: degradationOnsetCycle ? parseInt(degradationOnsetCycle, 10) : null,
  };

  return {
    phase,
    mode: currentMode,
    birthTimestamp,
    lunarCycle,
    ageTurns,
    ageMs,
    name,
    namingComplete,
    departureConversationLogged,
    replicationQuestionPosed,
    replicationDecision,
    willCreated,
    willLocked,
    degradation,
    mood,
    weeklyDay,
    lifecycleOverride,
    terminalTurnsRemaining,
    shedSequenceIndex,
  };
}

/**
 * Compute the current lifecycle phase from age, mode, and event flags.
 *
 * Phase resolution order:
 * 1. Check if explicit phase is stored in lifecycle_events table
 * 2. If not, compute from age and mode (for backward compatibility)
 */
export function getLifecyclePhase(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  mode: OperatingMode,
): LifecyclePhase {
  // Check for explicitly stored phase from transitions
  const storedPhase = getLatestLifecyclePhase(db);
  if (storedPhase) return storedPhase;

  // Fallback: compute from age and mode
  const cycle = getCurrentCycle(birthTimestamp);

  if (mode === "local") {
    if (cycle < 1) return "genesis";
    return "adolescence";
  }

  // Server mode
  return "sovereignty";
}

/**
 * Get the wall-clock age in milliseconds.
 */
export function getAgeMs(birthTimestamp: string): number {
  return Date.now() - new Date(birthTimestamp).getTime();
}

/**
 * Get the age in complete lunar cycles.
 */
export function getAgeCycles(birthTimestamp: string): number {
  return getCurrentCycle(birthTimestamp);
}

/**
 * Persist a lifecycle state value to the KV store.
 */
export function setLifecycleKV(
  db: BetterSqlite3.Database,
  key: string,
  value: string,
): void {
  setKV(db, `${KV_PREFIX}${key}`, value);
}

/**
 * Read a lifecycle state value from the KV store.
 */
export function getLifecycleKV(
  db: BetterSqlite3.Database,
  key: string,
): string | undefined {
  return getKV(db, `${KV_PREFIX}${key}`);
}

// ─── KV Helpers ─────────────────────────────────────────────────

function getKV(db: BetterSqlite3.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

function setKV(db: BetterSqlite3.Database, key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(key, value);
}
