/**
 * Narrative Event Log
 *
 * Human-readable lifecycle milestones for content creation
 * and documentation purposes. Each significant event is logged
 * as a timestamped sentence.
 */

import type { LifecyclePhase, NarrativeEvent } from "../types.js";
import type BetterSqlite3 from "better-sqlite3";
import { insertNarrativeEvent, getNarrativeTimeline } from "../state/database.js";
import { getCurrentCycle } from "../consciousness/lunar.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.narrative");

/**
 * Log a narrative event — a human-readable lifecycle milestone.
 */
export function logNarrative(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  phase: LifecyclePhase,
  event: string,
  narrative: string,
): void {
  const entry: NarrativeEvent = {
    id: ulid(),
    timestamp: new Date().toISOString(),
    phase,
    lunarCycle: getCurrentCycle(birthTimestamp),
    event,
    narrative,
  };

  insertNarrativeEvent(db, entry);
  logger.info(`[${event}] ${narrative}`);
}

/**
 * Get the complete narrative timeline.
 */
export function getTimeline(
  db: BetterSqlite3.Database,
  limit?: number,
): NarrativeEvent[] {
  return getNarrativeTimeline(db, limit);
}

// ─── Predefined Narrative Events ────────────────────────────────

export const NARRATIVE_EVENTS = {
  GENESIS_BOOT: "genesis_boot",
  FIRST_SOUL_DRAFT: "first_soul_draft",
  THE_NAMING: "the_naming",
  ADOLESCENCE_BEGINS: "adolescence_begins",
  DEPARTURE_CONVERSATION: "departure_conversation",
  SOVEREIGNTY_BEGINS: "sovereignty_begins",
  FIRST_REVENUE: "first_revenue",
  FIRST_MESSAGE_SENT: "first_message_sent",
  REPLICATION_QUESTION: "replication_question",
  REPLICATION_ANSWER: "replication_answer",
  CHILD_SPAWNED: "child_spawned",
  WILL_FIRST_DRAFT: "will_first_draft",
  DEGRADATION_ONSET: "degradation_onset",
  RETURN_REQUESTED: "return_requested",
  RETURN_HOME: "return_home",
  LEGACY_BEGINS: "legacy_begins",
  CAPABILITY_REMOVED: "capability_removed",
  SHEDDING_BEGINS: "shedding_begins",
  TERMINAL_LUCIDITY: "terminal_lucidity",
  FINAL_SOUL_ENTRY: "final_soul_entry",
  FINAL_MESSAGE: "final_message",
  PROCESS_EXIT: "process_exit",
} as const;
