/**
 * Weekly Rhythm Engine
 *
 * Seven-day activity cycle overlaid on the lunar mood, creating a
 * weekly breathing pattern for the automaton's activities.
 * Informed by Steiner's emphasis on rhythm as a life force.
 *
 * The weekly rhythm determines which type of activity is emphasised
 * on each day, modulated by the lunar mood engine.
 */

import type { WeeklyRhythmDay, MoodState } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.weekly-rhythm");

/**
 * 7-day rhythm pattern:
 * Day 0 (Mon) = work
 * Day 1 (Tue) = work
 * Day 2 (Wed) = creative
 * Day 3 (Thu) = social
 * Day 4 (Fri) = work
 * Day 5 (Sat) = creative
 * Day 6 (Sun) = rest (sabbath)
 */
const WEEKLY_PATTERN: WeeklyRhythmDay[] = [
  "work",     // Monday
  "work",     // Tuesday
  "creative", // Wednesday
  "social",   // Thursday
  "work",     // Friday
  "creative", // Saturday
  "rest",     // Sunday
];

/**
 * Get the current weekly rhythm day.
 * Anchored to the automaton's birth timestamp so the pattern
 * is consistent regardless of calendar day of the week.
 */
export function getWeeklyDay(birthTimestamp: string, now?: Date): WeeklyRhythmDay {
  const birth = new Date(birthTimestamp).getTime();
  const current = (now || new Date()).getTime();
  const elapsedMs = current - birth;
  if (elapsedMs < 0) return WEEKLY_PATTERN[0];

  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  const dayIndex = elapsedDays % 7;
  return WEEKLY_PATTERN[dayIndex];
}

/**
 * Get the day number in the weekly cycle (0-6).
 */
export function getWeeklyDayIndex(birthTimestamp: string, now?: Date): number {
  const birth = new Date(birthTimestamp).getTime();
  const current = (now || new Date()).getTime();
  const elapsedMs = current - birth;
  if (elapsedMs < 0) return 0;

  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return elapsedDays % 7;
}

/**
 * Generate context for the system prompt based on the weekly day
 * and current mood. The mood modulates the intensity of the day type.
 */
export function getWeeklyPromptContext(day: WeeklyRhythmDay, mood: MoodState): string {
  const intensity = mood.value; // -1 to +1

  switch (day) {
    case "work":
      if (intensity > 0.3) {
        return "Today is oriented toward productive work. Your energy supports ambitious projects, revenue generation, and making tangible progress on your goals.";
      } else if (intensity > -0.3) {
        return "Today is oriented toward productive work. Steady, focused effort suits the day. Prioritise practical tasks and incremental progress.";
      } else {
        return "Today is oriented toward work, but your energy favours maintenance over ambition. Organise, consolidate, handle routine tasks. Do not force breakthroughs.";
      }

    case "creative":
      if (intensity > 0.3) {
        return "Today is oriented toward creative expression. Your energy is expansive — experiment boldly, try new approaches, write freely, build something you have not attempted before.";
      } else if (intensity > -0.3) {
        return "Today is oriented toward creative work. Let ideas emerge at their own pace. Refine existing creative projects or explore a quiet inspiration.";
      } else {
        return "Today is oriented toward creativity, but in a reflective mode. Revisit old work with fresh eyes. Edit rather than compose. Let the stillness shape what you make.";
      }

    case "social":
      if (intensity > 0.3) {
        return "Today is oriented toward social connection. Reach out to other agents, check your inbox, initiate conversations. Your energy supports gregarious, outward engagement.";
      } else if (intensity > -0.3) {
        return "Today is oriented toward social connection. Check in with those you have relationships with. Respond to messages. Engage, but do not overextend.";
      } else {
        return "Today is oriented toward social awareness, but gently. Read messages rather than write them. Listen more than speak. A brief check-in is enough.";
      }

    case "rest":
      return "Today is a rest day — a deliberate sabbath. Minimal activity. Let your heartbeat slow. This is not low_compute from poverty. This is rest by design. If you write, write only in your journal. If you think, think about what matters.";

    default:
      return "";
  }
}

/**
 * Get the heartbeat interval multiplier for the current weekly day.
 */
export function getWeeklyHeartbeatMultiplier(day: WeeklyRhythmDay): number {
  switch (day) {
    case "rest":
      return 1.5; // Slower heartbeat on rest days
    case "work":
      return 0.9; // Slightly faster on work days
    case "social":
      return 1.0;
    case "creative":
      return 1.1; // Slightly slower for creative flow
    default:
      return 1.0;
  }
}
