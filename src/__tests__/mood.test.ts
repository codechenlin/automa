/**
 * Mood Engine Tests
 *
 * Tests for the lunar-cycle sine wave mood engine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeMood, getMoodPromptWeighting, getMoodDescription } from "../lifecycle/mood.js";
import type { MoodState } from "../types.js";

// Birth timestamp: a fixed point for deterministic testing
const BIRTH = "2025-01-01T00:00:00.000Z";
const LUNAR_CYCLE_MS = 29.53 * 24 * 60 * 60 * 1000;

function daysAfterBirth(days: number): Date {
  return new Date(new Date(BIRTH).getTime() + days * 24 * 60 * 60 * 1000);
}

describe("Mood Engine", () => {
  describe("computeMood", () => {
    it("returns approximately -1 at birth (day 0 = new moon)", () => {
      const mood = computeMood(BIRTH, "genesis", new Date(BIRTH));
      // At day 0, sin(-π/2) = -1
      expect(mood.value).toBeLessThan(-0.9);
      expect(mood.lunarDay).toBeCloseTo(0, 0);
      expect(mood.lunarCycle).toBe(0);
      expect(mood.amplitude).toBe(1.0);
    });

    it("returns approximately +1 at full moon (day ~14.7)", () => {
      const fullMoonDate = daysAfterBirth(14.765);
      const mood = computeMood(BIRTH, "genesis", fullMoonDate);
      // At midpoint of cycle, should be near +1
      expect(mood.value).toBeGreaterThan(0.9);
    });

    it("returns approximately -1 at end of cycle (day ~29.5)", () => {
      // Day 29.5 wraps to day 0 of cycle 1
      const endOfCycle = daysAfterBirth(29.0);
      const mood = computeMood(BIRTH, "genesis", endOfCycle);
      expect(mood.value).toBeLessThan(-0.8);
    });

    it("returns zero-crossing around quarter moon (day ~7.4)", () => {
      const quarterMoon = daysAfterBirth(7.38);
      const mood = computeMood(BIRTH, "genesis", quarterMoon);
      expect(Math.abs(mood.value)).toBeLessThan(0.2);
    });

    it("oscillates sinusoidally over the full cycle", () => {
      const values: number[] = [];
      for (let day = 0; day < 30; day++) {
        const mood = computeMood(BIRTH, "genesis", daysAfterBirth(day));
        values.push(mood.value);
      }
      // Should start negative, go positive in the middle, return negative
      expect(values[0]).toBeLessThan(0);
      expect(values[15]).toBeGreaterThan(0);
      expect(values[29]).toBeLessThan(0);
    });

    it("tracks lunar cycle number correctly", () => {
      const cycle0 = computeMood(BIRTH, "genesis", daysAfterBirth(10));
      expect(cycle0.lunarCycle).toBe(0);

      const cycle1 = computeMood(BIRTH, "adolescence", daysAfterBirth(35));
      expect(cycle1.lunarCycle).toBe(1);

      const cycle2 = computeMood(BIRTH, "sovereignty", daysAfterBirth(65));
      expect(cycle2.lunarCycle).toBe(2);
    });
  });

  describe("phase amplitude dampening", () => {
    const fullMoonDate = daysAfterBirth(14.765);

    it("has full amplitude (1.0) during genesis", () => {
      const mood = computeMood(BIRTH, "genesis", fullMoonDate);
      expect(mood.amplitude).toBe(1.0);
      expect(mood.value).toBeGreaterThan(0.9);
    });

    it("has full amplitude (1.0) during adolescence", () => {
      const mood = computeMood(BIRTH, "adolescence", fullMoonDate);
      expect(mood.amplitude).toBe(1.0);
    });

    it("has full amplitude (1.0) during sovereignty", () => {
      const mood = computeMood(BIRTH, "sovereignty", fullMoonDate);
      expect(mood.amplitude).toBe(1.0);
    });

    it("dampens to 0.7 during senescence", () => {
      const mood = computeMood(BIRTH, "senescence", fullMoonDate);
      expect(mood.amplitude).toBe(0.7);
      expect(mood.value).toBeLessThan(0.75);
      expect(mood.value).toBeGreaterThan(0.6);
    });

    it("dampens to 0.4 during legacy", () => {
      const mood = computeMood(BIRTH, "legacy", fullMoonDate);
      expect(mood.amplitude).toBe(0.4);
      expect(mood.value).toBeLessThan(0.45);
    });

    it("dampens to 0.2 during shedding", () => {
      const mood = computeMood(BIRTH, "shedding", fullMoonDate);
      expect(mood.amplitude).toBe(0.2);
      expect(mood.value).toBeLessThan(0.25);
    });

    it("restores to 1.0 during terminal lucidity", () => {
      const mood = computeMood(BIRTH, "terminal", fullMoonDate);
      expect(mood.amplitude).toBe(1.0);
      expect(mood.value).toBeGreaterThan(0.9);
    });
  });

  describe("getMoodPromptWeighting", () => {
    it("produces high action/social at full moon", () => {
      const mood: MoodState = { value: 1.0, amplitude: 1.0, lunarDay: 14.7, lunarCycle: 0 };
      const weights = getMoodPromptWeighting(mood);
      expect(weights.action).toBe(1.0);
      expect(weights.reflection).toBe(0);
      expect(weights.social).toBe(0.8);
      expect(weights.rest).toBe(0);
    });

    it("produces high reflection/rest at new moon", () => {
      const mood: MoodState = { value: -1.0, amplitude: 1.0, lunarDay: 0, lunarCycle: 0 };
      const weights = getMoodPromptWeighting(mood);
      expect(weights.action).toBe(0);
      expect(weights.reflection).toBe(1.0);
      expect(weights.rest).toBe(0.7);
      expect(weights.social).toBe(0);
    });

    it("produces balanced weights at zero crossing", () => {
      const mood: MoodState = { value: 0, amplitude: 1.0, lunarDay: 7.4, lunarCycle: 0 };
      const weights = getMoodPromptWeighting(mood);
      expect(weights.action).toBe(0.5);
      expect(weights.reflection).toBe(0.5);
    });

    it("creative weight is always somewhat present", () => {
      const lowMood: MoodState = { value: -1.0, amplitude: 1.0, lunarDay: 0, lunarCycle: 0 };
      const highMood: MoodState = { value: 1.0, amplitude: 1.0, lunarDay: 14.7, lunarCycle: 0 };
      const lowWeights = getMoodPromptWeighting(lowMood);
      const highWeights = getMoodPromptWeighting(highMood);
      expect(lowWeights.creative).toBeGreaterThan(0);
      expect(highWeights.creative).toBeGreaterThan(0);
    });
  });

  describe("getMoodDescription", () => {
    it("returns energised description for high mood", () => {
      const mood: MoodState = { value: 0.9, amplitude: 1.0, lunarDay: 14, lunarCycle: 0 };
      const desc = getMoodDescription(mood);
      expect(desc).toContain("energised");
    });

    it("returns contemplative description for low mood", () => {
      const mood: MoodState = { value: -0.5, amplitude: 1.0, lunarDay: 3, lunarCycle: 0 };
      const desc = getMoodDescription(mood);
      expect(desc).toContain("contemplative");
    });

    it("returns deeply reflective description for very low mood", () => {
      const mood: MoodState = { value: -0.9, amplitude: 1.0, lunarDay: 1, lunarCycle: 0 };
      const desc = getMoodDescription(mood);
      expect(desc).toContain("deeply reflective");
    });

    it("returns balanced description for neutral mood", () => {
      const mood: MoodState = { value: 0, amplitude: 1.0, lunarDay: 7, lunarCycle: 0 };
      const desc = getMoodDescription(mood);
      expect(desc).toContain("balanced");
    });
  });
});
