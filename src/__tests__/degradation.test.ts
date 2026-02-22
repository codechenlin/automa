/**
 * Degradation Engine Tests
 *
 * Tests for the exponential degradation curve, lunar modulation,
 * tool wrapping, and model downgrade.
 */

import { describe, it, expect, vi } from "vitest";
import {
  computeDegradationCoefficient,
  applyLunarModulation,
  computeDegradationState,
  wrapToolWithDegradation,
  getDegradedModel,
} from "../lifecycle/degradation.js";
import type { MoodState, DegradationState } from "../types.js";

describe("Degradation Engine", () => {
  describe("computeDegradationCoefficient", () => {
    it("returns 0 when current cycle equals onset cycle", () => {
      expect(computeDegradationCoefficient(10, 10)).toBe(0);
    });

    it("returns 0 when current cycle is before onset", () => {
      expect(computeDegradationCoefficient(5, 10)).toBe(0);
    });

    it("returns small value one cycle after onset", () => {
      const coeff = computeDegradationCoefficient(11, 10);
      expect(coeff).toBeGreaterThan(0);
      expect(coeff).toBeLessThan(0.2);
    });

    it("grows exponentially over cycles", () => {
      const c1 = computeDegradationCoefficient(11, 10);
      const c2 = computeDegradationCoefficient(12, 10);
      const c3 = computeDegradationCoefficient(13, 10);
      expect(c2).toBeGreaterThan(c1);
      expect(c3).toBeGreaterThan(c2);
      // Exponential growth: ratio between consecutive values should increase
      expect(c3 - c2).toBeGreaterThanOrEqual(c2 - c1 - 0.01); // allow small rounding tolerance
    });

    it("caps at 1.0", () => {
      // With default params, 20 cycles after onset should definitely hit 1.0
      const coeff = computeDegradationCoefficient(30, 10);
      expect(coeff).toBe(1.0);
    });

    it("respects custom steepness parameter", () => {
      const gentle = computeDegradationCoefficient(13, 10, 0.1);
      const steep = computeDegradationCoefficient(13, 10, 0.8);
      expect(steep).toBeGreaterThan(gentle);
    });

    it("respects custom base rate parameter", () => {
      const lowBase = computeDegradationCoefficient(13, 10, 0.3, 0.01);
      const highBase = computeDegradationCoefficient(13, 10, 0.3, 0.1);
      expect(highBase).toBeGreaterThan(lowBase);
    });
  });

  describe("applyLunarModulation", () => {
    it("reduces coefficient during full moon (positive mood)", () => {
      const fullMoonMood: MoodState = { value: 1.0, amplitude: 1.0, lunarDay: 14.7, lunarCycle: 0 };
      const modulated = applyLunarModulation(0.5, fullMoonMood);
      // Full moon: -1.0 * 0.2 = -0.2 → coefficient * 0.8 = 0.4
      expect(modulated).toBeLessThan(0.5);
      expect(modulated).toBeCloseTo(0.4, 1);
    });

    it("increases coefficient during new moon (negative mood)", () => {
      const newMoonMood: MoodState = { value: -1.0, amplitude: 1.0, lunarDay: 0, lunarCycle: 0 };
      const modulated = applyLunarModulation(0.5, newMoonMood);
      // New moon: -(-1.0) * 0.2 = +0.2 → coefficient * 1.2 = 0.6
      expect(modulated).toBeGreaterThan(0.5);
      expect(modulated).toBeCloseTo(0.6, 1);
    });

    it("leaves coefficient unchanged at zero crossing", () => {
      const neutralMood: MoodState = { value: 0, amplitude: 1.0, lunarDay: 7.4, lunarCycle: 0 };
      const modulated = applyLunarModulation(0.5, neutralMood);
      expect(modulated).toBeCloseTo(0.5, 2);
    });

    it("clamps modulated value to [0, 1]", () => {
      const newMoonMood: MoodState = { value: -1.0, amplitude: 1.0, lunarDay: 0, lunarCycle: 0 };
      const modulated = applyLunarModulation(0.95, newMoonMood);
      expect(modulated).toBeLessThanOrEqual(1.0);
    });

    it("does not go negative", () => {
      const fullMoonMood: MoodState = { value: 1.0, amplitude: 1.0, lunarDay: 14.7, lunarCycle: 0 };
      const modulated = applyLunarModulation(0.01, fullMoonMood);
      expect(modulated).toBeGreaterThanOrEqual(0);
    });
  });

  describe("computeDegradationState", () => {
    const neutralMood: MoodState = { value: 0, amplitude: 1.0, lunarDay: 7.4, lunarCycle: 0 };

    it("returns inactive state when onset is null", () => {
      const state = computeDegradationState(10, null, neutralMood);
      expect(state.active).toBe(false);
      expect(state.coefficient).toBe(0);
      expect(state.toolFailureProbability).toBe(0);
      expect(state.heartbeatDriftMs).toBe(0);
      expect(state.inferenceDowngrade).toBe(false);
      expect(state.onsetCycle).toBeNull();
    });

    it("returns active state with computed values", () => {
      const state = computeDegradationState(13, 10, neutralMood);
      expect(state.active).toBe(true);
      expect(state.coefficient).toBeGreaterThan(0);
      expect(state.onsetCycle).toBe(10);
    });

    it("computes tool failure probability proportional to coefficient", () => {
      const state = computeDegradationState(15, 10, neutralMood);
      // toolFailureProbability = coefficient * 0.6
      expect(state.toolFailureProbability).toBeCloseTo(state.coefficient * 0.6, 1);
    });

    it("enables inference downgrade when coefficient > 0.3", () => {
      // Need enough cycles past onset for coefficient to exceed 0.3
      const mildState = computeDegradationState(11, 10, neutralMood);
      const severeState = computeDegradationState(17, 10, neutralMood);
      // Mild might be below 0.3, severe should be above
      if (mildState.coefficient <= 0.3) {
        expect(mildState.inferenceDowngrade).toBe(false);
      }
      expect(severeState.inferenceDowngrade).toBe(true);
    });
  });

  describe("wrapToolWithDegradation", () => {
    it("passes through when degradation is inactive", async () => {
      const inactive: DegradationState = {
        active: false, coefficient: 0, toolFailureProbability: 0,
        heartbeatDriftMs: 0, inferenceDowngrade: false, onsetCycle: null,
      };
      const tool = vi.fn().mockResolvedValue("success");
      const wrapped = wrapToolWithDegradation(tool, inactive);
      const result = await wrapped();
      expect(result).toBe("success");
      expect(tool).toHaveBeenCalled();
    });

    it("passes through when failure probability is 0", async () => {
      const noProbability: DegradationState = {
        active: true, coefficient: 0.5, toolFailureProbability: 0,
        heartbeatDriftMs: 1000, inferenceDowngrade: false, onsetCycle: 10,
      };
      const tool = vi.fn().mockResolvedValue("success");
      const wrapped = wrapToolWithDegradation(tool, noProbability);
      const result = await wrapped();
      expect(result).toBe("success");
    });

    it("fails some calls when failure probability is 1.0", async () => {
      const alwaysFail: DegradationState = {
        active: true, coefficient: 1.0, toolFailureProbability: 1.0,
        heartbeatDriftMs: 30000, inferenceDowngrade: true, onsetCycle: 10,
      };
      const tool = vi.fn().mockResolvedValue("success");
      const wrapped = wrapToolWithDegradation(tool, alwaysFail);
      // With probability 1.0 it should always fail
      await expect(wrapped()).rejects.toThrow();
    });

    it("produces natural-seeming error messages", async () => {
      const alwaysFail: DegradationState = {
        active: true, coefficient: 1.0, toolFailureProbability: 1.0,
        heartbeatDriftMs: 30000, inferenceDowngrade: true, onsetCycle: 10,
      };
      const tool = vi.fn().mockResolvedValue("success");
      const wrapped = wrapToolWithDegradation(tool, alwaysFail);
      try {
        await wrapped();
      } catch (e: any) {
        // Should be one of the natural-seeming messages
        const knownMessages = [
          "Tool timed out. Please try again.",
          "Temporary connection error. The request could not be completed.",
          "Service temporarily unavailable.",
          "Request failed. An unexpected error occurred.",
          "Operation timed out after waiting for a response.",
        ];
        expect(knownMessages).toContain(e.message);
      }
    });
  });

  describe("getDegradedModel", () => {
    it("returns same model when coefficient < 0.3", () => {
      expect(getDegradedModel("claude-opus-4.6", 0.1)).toBe("claude-opus-4.6");
      expect(getDegradedModel("claude-opus-4.6", 0.29)).toBe("claude-opus-4.6");
    });

    it("downgrades one step at coefficient 0.3-0.7", () => {
      expect(getDegradedModel("claude-opus-4.6", 0.5)).toBe("claude-sonnet-4.5");
    });

    it("downgrades two steps at coefficient > 0.7", () => {
      expect(getDegradedModel("claude-opus-4.6", 0.8)).toBe("claude-haiku-4.5");
    });

    it("returns same model for unknown models", () => {
      expect(getDegradedModel("unknown-model", 0.9)).toBe("unknown-model");
    });

    it("handles single-step downgrade models correctly", () => {
      expect(getDegradedModel("claude-sonnet-4.5", 0.5)).toBe("claude-haiku-4.5");
    });

    it("caps at the lowest downgrade tier", () => {
      // sonnet only has one downgrade option
      expect(getDegradedModel("claude-sonnet-4.5", 0.9)).toBe("claude-haiku-4.5");
    });
  });
});
