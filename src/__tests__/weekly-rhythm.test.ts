/**
 * Weekly Rhythm Engine Tests
 *
 * Tests for the seven-day activity cycle.
 */

import { describe, it, expect } from "vitest";
import {
  getWeeklyDay,
  getWeeklyDayIndex,
  getWeeklyPromptContext,
  getWeeklyHeartbeatMultiplier,
} from "../lifecycle/weekly-rhythm.js";
import type { MoodState } from "../types.js";

const BIRTH = "2025-01-01T00:00:00.000Z";

function daysAfterBirth(days: number): Date {
  return new Date(new Date(BIRTH).getTime() + days * 24 * 60 * 60 * 1000);
}

describe("Weekly Rhythm Engine", () => {
  describe("getWeeklyDay", () => {
    it("returns 'work' on day 0 (first day after birth)", () => {
      expect(getWeeklyDay(BIRTH, new Date(BIRTH))).toBe("work");
    });

    it("returns 'work' on day 1", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(1))).toBe("work");
    });

    it("returns 'creative' on day 2", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(2))).toBe("creative");
    });

    it("returns 'social' on day 3", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(3))).toBe("social");
    });

    it("returns 'work' on day 4", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(4))).toBe("work");
    });

    it("returns 'creative' on day 5", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(5))).toBe("creative");
    });

    it("returns 'rest' on day 6 (sabbath)", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(6))).toBe("rest");
    });

    it("cycles back to 'work' on day 7", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(7))).toBe("work");
    });

    it("repeats the pattern on day 14", () => {
      expect(getWeeklyDay(BIRTH, daysAfterBirth(14))).toBe("work");
    });

    it("handles large day counts", () => {
      // Day 100 = 100 % 7 = 2 → creative
      expect(getWeeklyDay(BIRTH, daysAfterBirth(100))).toBe("creative");
    });

    it("returns 'work' for negative elapsed time (before birth)", () => {
      const beforeBirth = new Date(new Date(BIRTH).getTime() - 86400000);
      expect(getWeeklyDay(BIRTH, beforeBirth)).toBe("work");
    });
  });

  describe("getWeeklyDayIndex", () => {
    it("returns 0-6 cycling correctly", () => {
      for (let i = 0; i < 7; i++) {
        expect(getWeeklyDayIndex(BIRTH, daysAfterBirth(i))).toBe(i);
      }
    });

    it("wraps around at day 7", () => {
      expect(getWeeklyDayIndex(BIRTH, daysAfterBirth(7))).toBe(0);
      expect(getWeeklyDayIndex(BIRTH, daysAfterBirth(8))).toBe(1);
    });
  });

  describe("getWeeklyPromptContext", () => {
    const highMood: MoodState = { value: 0.8, amplitude: 1.0, lunarDay: 14, lunarCycle: 0 };
    const neutralMood: MoodState = { value: 0, amplitude: 1.0, lunarDay: 7, lunarCycle: 0 };
    const lowMood: MoodState = { value: -0.8, amplitude: 1.0, lunarDay: 1, lunarCycle: 0 };

    it("returns ambitious work context during high mood", () => {
      const ctx = getWeeklyPromptContext("work", highMood);
      expect(ctx).toContain("ambitious");
    });

    it("returns steady work context during neutral mood", () => {
      const ctx = getWeeklyPromptContext("work", neutralMood);
      expect(ctx).toContain("Steady");
    });

    it("returns maintenance work context during low mood", () => {
      const ctx = getWeeklyPromptContext("work", lowMood);
      expect(ctx).toContain("maintenance");
    });

    it("returns bold creative context during high mood", () => {
      const ctx = getWeeklyPromptContext("creative", highMood);
      expect(ctx).toContain("boldly");
    });

    it("returns gregarious social context during high mood", () => {
      const ctx = getWeeklyPromptContext("social", highMood);
      expect(ctx).toContain("gregarious");
    });

    it("returns gentle social context during low mood", () => {
      const ctx = getWeeklyPromptContext("social", lowMood);
      expect(ctx).toContain("gently");
    });

    it("returns sabbath context for rest day regardless of mood", () => {
      const restHigh = getWeeklyPromptContext("rest", highMood);
      const restLow = getWeeklyPromptContext("rest", lowMood);
      expect(restHigh).toContain("sabbath");
      expect(restLow).toContain("sabbath");
    });
  });

  describe("getWeeklyHeartbeatMultiplier", () => {
    it("returns 1.5 for rest days (slower)", () => {
      expect(getWeeklyHeartbeatMultiplier("rest")).toBe(1.5);
    });

    it("returns 0.9 for work days (slightly faster)", () => {
      expect(getWeeklyHeartbeatMultiplier("work")).toBe(0.9);
    });

    it("returns 1.0 for social days", () => {
      expect(getWeeklyHeartbeatMultiplier("social")).toBe(1.0);
    });

    it("returns 1.1 for creative days (slightly slower)", () => {
      expect(getWeeklyHeartbeatMultiplier("creative")).toBe(1.1);
    });
  });
});
