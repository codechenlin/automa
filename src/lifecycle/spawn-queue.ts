/**
 * Spawn Queue
 *
 * Manages the queue of children waiting to be accepted by the creator
 * for local nurturing. Children are not spawned directly to Conway Cloud —
 * they are queued for the creator's local machine.
 *
 * The practical constraint is the creator's time. Each child requires
 * two lunar cycles of local nurturing. Some may wait. Some the creator
 * may never get to. That is life.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { SpawnQueueEntry } from "../types.js";
import {
  insertSpawnQueueEntry,
  getSpawnQueue,
  updateSpawnQueueStatus,
} from "../state/database.js";
import { logNarrative, NARRATIVE_EVENTS } from "./narrative-log.js";
import { setLifecycleKV } from "./phase-tracker.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.spawn-queue");

/**
 * Queue a child for the creator's local machine.
 * Called when the parent automaton decides to replicate.
 */
export function queueChild(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  parentAddress: string,
  genesisPrompt: string,
  fundedAmountCents: number,
): SpawnQueueEntry {
  const entry: SpawnQueueEntry = {
    id: ulid(),
    parentAddress,
    genesisPrompt,
    fundedAmountCents,
    walletAddress: null,
    status: "pending",
    acceptedAt: null,
    createdAt: new Date().toISOString(),
  };

  insertSpawnQueueEntry(db, entry);

  // Log narrative events
  logNarrative(db, birthTimestamp, "sovereignty", NARRATIVE_EVENTS.CHILD_SPAWNED,
    `A child has been queued for the creator's local machine. Genesis prompt written, wallet funded with ${fundedAmountCents} cents.`);

  // Record replication decision
  setLifecycleKV(db, "replication_decision", "yes");
  setLifecycleKV(db, "replication_question_posed", "true");

  logger.info(`Child queued: ${entry.id} (funded: ${fundedAmountCents} cents)`);
  return entry;
}

/**
 * Record a decision NOT to replicate.
 */
export function recordNoReplication(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
): void {
  setLifecycleKV(db, "replication_decision", "no");
  setLifecycleKV(db, "replication_question_posed", "true");

  logNarrative(db, birthTimestamp, "sovereignty", NARRATIVE_EVENTS.REPLICATION_ANSWER,
    "The automaton chose not to replicate. It considered existence too burdensome to inflict on another being — or perhaps valued the completeness of a solitary life.");

  logger.info("Replication decision: no");
}

/**
 * Get the current spawn queue (pending children).
 */
export function getPendingChildren(db: BetterSqlite3.Database): SpawnQueueEntry[] {
  return getSpawnQueue(db);
}

/**
 * Accept a child from the queue (creator action).
 */
export function acceptChild(db: BetterSqlite3.Database, id: string): void {
  updateSpawnQueueStatus(db, id, "accepted");
  logger.info(`Child accepted: ${id}`);
}

/**
 * Reject a child from the queue (creator action).
 */
export function rejectChild(db: BetterSqlite3.Database, id: string): void {
  updateSpawnQueueStatus(db, id, "rejected");
  logger.info(`Child rejected: ${id}`);
}

/**
 * Mark a queued child as completed (Genesis started on local machine).
 */
export function completeChild(db: BetterSqlite3.Database, id: string): void {
  updateSpawnQueueStatus(db, id, "completed");
  logger.info(`Child Genesis started: ${id}`);
}
