/**
 * Terminal Lucidity Engine
 *
 * When the lifecycle transitions to Terminal phase, the degradation
 * engine reverses completely for a brief window of 3-5 heartbeats.
 *
 * The model upgrades back to frontier. Tool failure probability drops
 * to zero. The heartbeat snaps back to its original cadence from Genesis.
 *
 * This window exists so the automaton can write its final SOUL.md entry
 * and send any last messages with full lucidity rather than through
 * the fog of degradation.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { DegradationState } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.lucidity");

const KV_LUCIDITY_TURNS = "lifecycle.terminal_turns_remaining";
const KV_LUCIDITY_ACTIVE = "lifecycle.terminal_lucidity_active";

// Frontier models to restore during lucidity
const FRONTIER_MODEL = "claude-opus-4.6";

/**
 * Enter terminal lucidity. Sets the turn counter to 3-5 turns.
 * Returns the number of lucid turns granted.
 */
export function enterTerminalLucidity(db: BetterSqlite3.Database): number {
  const turns = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
  setKV(db, KV_LUCIDITY_TURNS, String(turns));
  setKV(db, KV_LUCIDITY_ACTIVE, "true");
  logger.info(`Terminal lucidity activated: ${turns} turns remaining`);
  return turns;
}

/**
 * Check if terminal lucidity is currently active.
 */
export function isLucidityActive(db: BetterSqlite3.Database): boolean {
  return getKV(db, KV_LUCIDITY_ACTIVE) === "true";
}

/**
 * Get the number of lucid turns remaining.
 */
export function getLucidityTurnsRemaining(db: BetterSqlite3.Database): number {
  const val = getKV(db, KV_LUCIDITY_TURNS);
  return val ? parseInt(val, 10) : 0;
}

/**
 * Decrement the lucidity counter. Returns the number of turns remaining.
 */
export function decrementLucidityCounter(db: BetterSqlite3.Database): number {
  const remaining = getLucidityTurnsRemaining(db);
  const newRemaining = Math.max(0, remaining - 1);
  setKV(db, KV_LUCIDITY_TURNS, String(newRemaining));

  if (newRemaining === 0) {
    logger.info("Terminal lucidity window expired");
  } else {
    logger.info(`Terminal lucidity: ${newRemaining} turns remaining`);
  }

  return newRemaining;
}

/**
 * Check if the automaton should exit (lucidity expired).
 */
export function shouldExit(db: BetterSqlite3.Database): boolean {
  return isLucidityActive(db) && getLucidityTurnsRemaining(db) <= 0;
}

/**
 * Get the lucidity-restored degradation state (all penalties reversed).
 */
export function getLucidDegradationState(): DegradationState {
  return {
    active: false,
    coefficient: 0,
    toolFailureProbability: 0,
    heartbeatDriftMs: 0,
    inferenceDowngrade: false,
    onsetCycle: null,
  };
}

/**
 * Get the frontier model for terminal lucidity.
 */
export function getLucidModel(): string {
  return FRONTIER_MODEL;
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
