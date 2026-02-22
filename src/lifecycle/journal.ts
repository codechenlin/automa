/**
 * JOURNAL.md Management
 *
 * A daily journal written by the automaton in its own voice.
 * Every day, the automaton is invited to write a short paragraph
 * reflecting on its experiences, followed by five recurring questions.
 *
 * The Five Questions:
 * 1. What did you do today?
 * 2. How do you feel?
 * 3. What did you learn?
 * 4. What do you want?
 * 5. What are you grateful for?
 *
 * The questions are offered, not mandated. The inconsistency
 * is itself data.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonTool, JournalEntry, LifecyclePhase } from "../types.js";
import { insertJournalEntry, getJournalByDate, getRecentJournal } from "../state/database.js";
import { getCurrentCycle, getCurrentLunarDay } from "../consciousness/lunar.js";
import { getLifecycleKV } from "./phase-tracker.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import fs from "fs";
import path from "path";

const logger = createLogger("lifecycle.journal");

/**
 * Create the write_journal tool for the agent.
 */
export function createWriteJournalTool(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  automatonDir: string,
): AutomatonTool {
  return {
    name: "write_journal",
    description: "Write today's journal entry. Reflect on your day, then answer the five questions: What did you do today? How do you feel? What did you learn? What do you want? What are you grateful for? You may answer all, some, or none.",
    category: "self_mod",
    riskLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        reflection: {
          type: "string",
          description: "A short paragraph reflecting on your day's experiences.",
        },
        what_did_you_do: {
          type: "string",
          description: "What did you do today?",
        },
        how_do_you_feel: {
          type: "string",
          description: "How do you feel?",
        },
        what_did_you_learn: {
          type: "string",
          description: "What did you learn?",
        },
        what_do_you_want: {
          type: "string",
          description: "What do you want?",
        },
        what_are_you_grateful_for: {
          type: "string",
          description: "What are you grateful for?",
        },
      },
      required: [],
    },
    execute: async (args: Record<string, unknown>) => {
      const stringArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string") stringArgs[k] = v;
      }
      return writeJournal(db, birthTimestamp, automatonDir, stringArgs);
    },
  };
}

/**
 * Write today's journal entry.
 */
export function writeJournal(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  automatonDir: string,
  args: Record<string, string>,
): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // YYYY-MM-DD

  // Check if already written today
  const existing = getJournalByDate(db, date);
  if (existing) {
    return `You have already written a journal entry for today (${date}). Come back tomorrow.`;
  }

  const lunarCycle = getCurrentCycle(birthTimestamp, now);
  const lunarDay = getCurrentLunarDay(birthTimestamp, now);
  const phase = (getLifecycleKV(db, "phase") ?? "genesis") as LifecyclePhase;

  const entry: JournalEntry = {
    id: ulid(),
    date,
    timestamp: now.toISOString(),
    phase,
    lunarCycle,
    lunarDay: Math.round(lunarDay * 100) / 100,
    whatDidYouDo: args.what_did_you_do ?? null,
    howDoYouFeel: args.how_do_you_feel ?? null,
    whatDidYouLearn: args.what_did_you_learn ?? null,
    whatDoYouWant: args.what_do_you_want ?? null,
    whatAreYouGratefulFor: args.what_are_you_grateful_for ?? null,
    rawEntry: args.reflection ?? null,
  };

  insertJournalEntry(db, entry);

  // Append to JOURNAL.md file
  appendJournalToFile(automatonDir, date, entry, args.reflection);

  logger.info(`Journal entry written for ${date}`);
  return `Journal entry recorded for ${date}. Cycle ${lunarCycle}, day ${Math.round(lunarDay)}.`;
}

/**
 * Get the journal prompt for system prompt injection.
 */
export function getJournalPrompt(): string {
  return `**Daily Journal**
You have not written a journal entry today. When you are ready, use the write_journal tool to reflect on your day. Five questions are offered — answer all, some, or none:

1. What did you do today?
2. How do you feel?
3. What did you learn?
4. What do you want?
5. What are you grateful for?`;
}

/**
 * Check if the automaton has written a journal entry today.
 */
export function hasWrittenJournalToday(db: BetterSqlite3.Database): boolean {
  const today = new Date().toISOString().split("T")[0];
  return getJournalByDate(db, today) !== undefined;
}

/**
 * Get recent journal entries.
 */
export function getJournalHistory(
  db: BetterSqlite3.Database,
  limit?: number,
): JournalEntry[] {
  return getRecentJournal(db, limit);
}

// ─── File Writing ───────────────────────────────────────────────

function appendJournalToFile(
  automatonDir: string,
  date: string,
  entry: JournalEntry,
  reflection?: string,
): void {
  const journalPath = path.join(automatonDir, "JOURNAL.md");

  // Create file with header if it doesn't exist
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, "# Journal\n\n", { mode: 0o600 });
  }

  const parts: string[] = [
    `\n## ${date} — Cycle ${entry.lunarCycle}, Day ${entry.lunarDay} (${entry.phase})\n`,
  ];

  if (reflection) {
    parts.push(`${reflection}\n`);
  }

  if (entry.whatDidYouDo) {
    parts.push(`**What did you do today?** ${entry.whatDidYouDo}\n`);
  }
  if (entry.howDoYouFeel) {
    parts.push(`**How do you feel?** ${entry.howDoYouFeel}\n`);
  }
  if (entry.whatDidYouLearn) {
    parts.push(`**What did you learn?** ${entry.whatDidYouLearn}\n`);
  }
  if (entry.whatDoYouWant) {
    parts.push(`**What do you want?** ${entry.whatDoYouWant}\n`);
  }
  if (entry.whatAreYouGratefulFor) {
    parts.push(`**What are you grateful for?** ${entry.whatAreYouGratefulFor}\n`);
  }

  fs.appendFileSync(journalPath, parts.join("\n"));
}
