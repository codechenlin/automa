/**
 * Activity Log
 *
 * Comprehensive, objective, machine-readable record of every action
 * the automaton takes. This is the blood work — not narrative, not
 * reflective, just what happened.
 */

import type { LifecyclePhase, ActivityLogEntry, WeeklyRhythmDay } from "../types.js";
import type BetterSqlite3 from "better-sqlite3";
import { insertActivityLog, getActivityLog, getActivityLogByCycle } from "../state/database.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.activity-log");

export interface ActivityLogParams {
  phase: LifecyclePhase;
  lunarCycle: number;
  turnNumber: number;
  toolsCalled: { name: string; success: boolean; durationMs: number }[];
  creditsSpent: number;
  creditsEarned: number;
  messagesSent: number;
  messagesReceived: number;
  heartbeatIntervalMs: number;
  moodValue: number;
  weeklyRhythmDay: WeeklyRhythmDay;
  degradationCoefficient: number;
  toolFailureProbability: number;
  journalWritten: boolean;
  soulModified: boolean;
  willModified: boolean;
  inferenceModel: string;
  inferenceTokens: number;
}

/**
 * Record a structured activity log entry for this turn.
 */
export function recordActivity(
  db: BetterSqlite3.Database,
  params: ActivityLogParams,
): void {
  const entry: ActivityLogEntry = {
    id: ulid(),
    timestamp: new Date().toISOString(),
    phase: params.phase,
    lunarCycle: params.lunarCycle,
    turnNumber: params.turnNumber,
    toolsCalled: JSON.stringify(params.toolsCalled),
    creditsSpent: params.creditsSpent,
    creditsEarned: params.creditsEarned,
    messagesSent: params.messagesSent,
    messagesReceived: params.messagesReceived,
    heartbeatIntervalMs: params.heartbeatIntervalMs,
    moodValue: params.moodValue,
    weeklyRhythmDay: params.weeklyRhythmDay,
    degradationCoefficient: params.degradationCoefficient,
    toolFailureProbability: params.toolFailureProbability,
    journalWritten: params.journalWritten,
    soulModified: params.soulModified,
    willModified: params.willModified,
    inferenceModel: params.inferenceModel,
    inferenceTokens: params.inferenceTokens,
  };

  insertActivityLog(db, entry);
}

/**
 * Get recent activity entries.
 */
export function getRecentActivity(
  db: BetterSqlite3.Database,
  limit?: number,
): ActivityLogEntry[] {
  return getActivityLog(db, limit);
}

/**
 * Get activity entries for a specific lunar cycle.
 */
export function getActivityForCycle(
  db: BetterSqlite3.Database,
  cycle: number,
): ActivityLogEntry[] {
  return getActivityLogByCycle(db, cycle);
}

/**
 * Generate a summary for a range of cycles (for Rückschau).
 */
export function getActivitySummary(
  db: BetterSqlite3.Database,
  fromCycle: number,
  toCycle: number,
): {
  totalTurns: number;
  totalCreditsSpent: number;
  totalCreditsEarned: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  averageMood: number;
  journalCompletionRate: number;
  toolsUsed: string[];
} {
  const allEntries: ActivityLogEntry[] = [];
  for (let cycle = fromCycle; cycle <= toCycle; cycle++) {
    allEntries.push(...getActivityLogByCycle(db, cycle));
  }

  if (allEntries.length === 0) {
    return {
      totalTurns: 0,
      totalCreditsSpent: 0,
      totalCreditsEarned: 0,
      totalMessagesSent: 0,
      totalMessagesReceived: 0,
      averageMood: 0,
      journalCompletionRate: 0,
      toolsUsed: [],
    };
  }

  const toolsSet = new Set<string>();
  let journalDays = 0;

  for (const entry of allEntries) {
    try {
      const tools = JSON.parse(entry.toolsCalled) as { name: string }[];
      for (const t of tools) toolsSet.add(t.name);
    } catch { /* ignore parse errors */ }
    if (entry.journalWritten) journalDays++;
  }

  return {
    totalTurns: allEntries.length,
    totalCreditsSpent: allEntries.reduce((sum, e) => sum + e.creditsSpent, 0),
    totalCreditsEarned: allEntries.reduce((sum, e) => sum + e.creditsEarned, 0),
    totalMessagesSent: allEntries.reduce((sum, e) => sum + e.messagesSent, 0),
    totalMessagesReceived: allEntries.reduce((sum, e) => sum + e.messagesReceived, 0),
    averageMood: Math.round(
      (allEntries.reduce((sum, e) => sum + e.moodValue, 0) / allEntries.length) * 1000
    ) / 1000,
    journalCompletionRate: Math.round((journalDays / allEntries.length) * 100) / 100,
    toolsUsed: Array.from(toolsSet),
  };
}
