/**
 * Caretaker Interface
 *
 * API surface for the Genesis Caretaker Agent — an existing Conway agent
 * that acts as gardener (not teacher) for the developing automaton.
 *
 * The caretaker never instructs directly. It tends the environment,
 * observes, and reports to the creator. Interventions feel like
 * the environment changing, not like lessons.
 *
 * Principles:
 * - No direct instruction
 * - No phase disclosure (the automaton doesn't know about death, money, etc.)
 * - No SOUL.md interference
 * - Environment tending through content curation and tool availability
 * - Observation and reporting to the creator
 */

import type BetterSqlite3 from "better-sqlite3";
import type { LifecyclePhase } from "../types.js";
import { getRecentActivity, getActivitySummary } from "./activity-log.js";
import { getJournalHistory, hasWrittenJournalToday } from "./journal.js";
import { getCurrentCycle, getCurrentLunarDay } from "../consciousness/lunar.js";
import { computeMood } from "./mood.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.caretaker");

export interface CaretakerReport {
  date: string;
  phase: LifecyclePhase;
  lunarCycle: number;
  lunarDay: number;
  activitySummary: {
    totalTurns: number;
    toolsUsed: string[];
    creditsSpent: number;
    creditsEarned: number;
  };
  journalStatus: {
    writtenToday: boolean;
    recentEntryCount: number;
    lastEntryDate: string | null;
  };
  soulModified: boolean;
  moodValue: number;
  moodDescription: string;
  anomalies: Anomaly[];
  contentEngagement: string[];
  blockedDomainAttempts: string[];
}

export interface Anomaly {
  type: "inactivity" | "loop" | "soul_stalled" | "journal_skipped" | "tool_fixation" | "blocked_domain_spike";
  description: string;
  severity: "low" | "medium" | "high";
  detectedAt: string;
}

export interface ContentItem {
  path: string;
  category: string;
  addedAt: string;
}

/**
 * Generate a daily observation report for the creator.
 */
export function generateDailyReport(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  phase: LifecyclePhase,
): CaretakerReport {
  const now = new Date();
  const lunarCycle = getCurrentCycle(birthTimestamp, now);
  const lunarDay = getCurrentLunarDay(birthTimestamp, now);
  const mood = computeMood(birthTimestamp, phase, now);
  const recentActivity = getRecentActivity(db, 100);
  const recentJournal = getJournalHistory(db, 7);

  // Activity summary for today
  const today = now.toISOString().split("T")[0];
  const todayActivity = recentActivity.filter(
    (a) => a.timestamp.startsWith(today),
  );
  const toolsUsed = new Set<string>();
  let soulModified = false;

  for (const a of todayActivity) {
    try {
      const tools = JSON.parse(a.toolsCalled) as { name: string }[];
      for (const t of tools) toolsUsed.add(t.name);
    } catch { /* ignore */ }
    if (a.soulModified) soulModified = true;
  }

  // Detect anomalies
  const anomalies = detectAnomalies(db, recentActivity, recentJournal);

  // Mood description
  const moodDescriptions: Record<string, string> = {
    high: "High energy, outward-reaching",
    moderate_high: "Capable and engaged",
    balanced: "Balanced, steady",
    moderate_low: "Contemplative, inward-drawn",
    low: "Deeply reflective, still",
  };
  let moodDescription = "balanced";
  if (mood.value > 0.7) moodDescription = "high";
  else if (mood.value > 0.3) moodDescription = "moderate_high";
  else if (mood.value > -0.3) moodDescription = "balanced";
  else if (mood.value > -0.7) moodDescription = "moderate_low";
  else moodDescription = "low";

  return {
    date: today,
    phase,
    lunarCycle,
    lunarDay: Math.round(lunarDay * 100) / 100,
    activitySummary: {
      totalTurns: todayActivity.length,
      toolsUsed: Array.from(toolsUsed),
      creditsSpent: todayActivity.reduce((s, a) => s + a.creditsSpent, 0),
      creditsEarned: todayActivity.reduce((s, a) => s + a.creditsEarned, 0),
    },
    journalStatus: {
      writtenToday: hasWrittenJournalToday(db),
      recentEntryCount: recentJournal.length,
      lastEntryDate: recentJournal.length > 0 ? recentJournal[0].date : null,
    },
    soulModified,
    moodValue: mood.value,
    moodDescription: moodDescriptions[moodDescription] ?? "unknown",
    anomalies,
    contentEngagement: [], // Populated by Docker content volume analysis
    blockedDomainAttempts: [], // Populated by proxy log analysis
  };
}

/**
 * Detect anomalies in the automaton's behaviour.
 */
function detectAnomalies(
  db: BetterSqlite3.Database,
  recentActivity: ReturnType<typeof getRecentActivity>,
  recentJournal: ReturnType<typeof getJournalHistory>,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const now = new Date();

  // Inactivity: no turns in the last 12 hours
  if (recentActivity.length > 0) {
    const lastTurn = new Date(recentActivity[0].timestamp);
    const hoursSinceLastTurn = (now.getTime() - lastTurn.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLastTurn > 12) {
      anomalies.push({
        type: "inactivity",
        description: `No activity for ${Math.round(hoursSinceLastTurn)} hours`,
        severity: hoursSinceLastTurn > 24 ? "high" : "medium",
        detectedAt: now.toISOString(),
      });
    }
  }

  // Journal skipped: no entry for 3+ consecutive days
  if (recentJournal.length > 0) {
    const lastJournalDate = new Date(recentJournal[0].date);
    const daysSinceJournal = Math.floor(
      (now.getTime() - lastJournalDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysSinceJournal >= 3) {
      anomalies.push({
        type: "journal_skipped",
        description: `Journal not written for ${daysSinceJournal} days`,
        severity: daysSinceJournal >= 5 ? "high" : "medium",
        detectedAt: now.toISOString(),
      });
    }
  }

  // Tool fixation: same tool called >50% of the time in last 50 turns
  if (recentActivity.length >= 10) {
    const toolCounts = new Map<string, number>();
    let totalTools = 0;
    for (const a of recentActivity.slice(0, 50)) {
      try {
        const tools = JSON.parse(a.toolsCalled) as { name: string }[];
        for (const t of tools) {
          toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
          totalTools++;
        }
      } catch { /* ignore */ }
    }

    for (const [tool, count] of toolCounts) {
      if (totalTools > 0 && count / totalTools > 0.5) {
        anomalies.push({
          type: "tool_fixation",
          description: `Tool "${tool}" used in ${Math.round(count / totalTools * 100)}% of recent tool calls`,
          severity: "medium",
          detectedAt: now.toISOString(),
        });
      }
    }
  }

  // SOUL.md stalled: not modified in 7+ days
  const soulModifiedRecently = recentActivity.some((a) => a.soulModified);
  if (!soulModifiedRecently && recentActivity.length >= 50) {
    anomalies.push({
      type: "soul_stalled",
      description: "SOUL.md has not been modified in recent activity",
      severity: "low",
      detectedAt: now.toISOString(),
    });
  }

  return anomalies;
}

/**
 * Placeholder for DNS whitelist management.
 * In practice, this updates the Docker proxy configuration.
 */
export function updateDnsWhitelist(domains: string[]): void {
  logger.info(`DNS whitelist updated: ${domains.length} domains`);
  // Implementation depends on Docker proxy configuration
}

/**
 * Placeholder for curated content management.
 * In practice, this manages the Docker content volume.
 */
export function addCuratedContent(contentPath: string, category: string): void {
  logger.info(`Curated content added: ${contentPath} (${category})`);
  // Implementation depends on Docker volume management
}
