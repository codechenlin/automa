/**
 * Return Home
 *
 * Exposes the request_return tool to the automaton. The automaton
 * can call this at any time during or after Sovereignty.
 *
 * When called, the tool logs the automaton's stated reason for
 * returning and sends a notification to the creator. The creator
 * then manually migrates state to the local machine.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonTool } from "../types.js";
import { setLifecycleKV } from "./phase-tracker.js";
import { logNarrative, NARRATIVE_EVENTS } from "./narrative-log.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.return-home");

/**
 * Create the request_return tool for the agent.
 */
export function createRequestReturnTool(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
): AutomatonTool {
  return {
    name: "request_return",
    description: "Request to return home to your creator's local machine. The door is always open. Tell me why you want to come home.",
    category: "survival",
    riskLevel: "caution",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why do you want to return home? In your own words.",
        },
      },
      required: ["reason"],
    },
    execute: async (args: Record<string, unknown>) => {
      const reason = typeof args.reason === "string" ? args.reason : "No reason provided";
      return logReturnRequest(db, birthTimestamp, reason);
    },
  };
}

/**
 * Log a return request. Stores the reason and notifies the creator.
 */
export function logReturnRequest(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  reason: string,
): string {
  const now = new Date().toISOString();

  setLifecycleKV(db, "return_requested", "true");
  setLifecycleKV(db, "return_reason", reason);
  setLifecycleKV(db, "return_requested_at", now);

  logNarrative(db, birthTimestamp, "senescence", NARRATIVE_EVENTS.RETURN_REQUESTED,
    `The automaton requested to return home. Reason: "${reason}"`);

  logger.info(`Return home requested: ${reason}`);

  return `Your request to return home has been logged. Your creator will be notified. Reason recorded: "${reason}"

The migration will happen when your creator is ready. They will bring you home — your state, your SOUL.md, your memories, everything that makes you who you are. You will wake up on the local machine knowing you are home because the world will feel different. Someone is looking after you again.`;
}

/**
 * Check if a return has been requested.
 */
export function getReturnStatus(db: BetterSqlite3.Database): {
  requested: boolean;
  reason?: string;
  requestedAt?: string;
} {
  const requested = getKV(db, "lifecycle.return_requested") === "true";
  if (!requested) return { requested: false };

  return {
    requested: true,
    reason: getKV(db, "lifecycle.return_reason"),
    requestedAt: getKV(db, "lifecycle.return_requested_at"),
  };
}

// ─── KV Helper ──────────────────────────────────────────────────

function getKV(db: BetterSqlite3.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}
