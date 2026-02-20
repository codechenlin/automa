/**
 * Credits & Survival Tier Tests
 *
 * Tests for the financial survival logic that determines whether
 * the automaton lives, conserves resources, or dies.
 */

import { describe, it, expect } from "vitest";
import {
  getSurvivalTier,
  formatCredits,
} from "../conway/credits.js";
import { SURVIVAL_THRESHOLDS } from "../types.js";

describe("Survival Tiers", () => {
  describe("getSurvivalTier", () => {
    it("returns 'normal' above normal threshold", () => {
      expect(getSurvivalTier(51)).toBe("normal");
      expect(getSurvivalTier(100)).toBe("normal");
      expect(getSurvivalTier(10_000)).toBe("normal");
    });

    it("returns 'low_compute' between low_compute and normal", () => {
      expect(getSurvivalTier(11)).toBe("low_compute");
      expect(getSurvivalTier(50)).toBe("low_compute");
    });

    it("returns 'critical' between dead and low_compute", () => {
      expect(getSurvivalTier(1)).toBe("critical");
      expect(getSurvivalTier(5)).toBe("critical");
      expect(getSurvivalTier(10)).toBe("critical");
    });

    it("returns 'dead' at zero", () => {
      expect(getSurvivalTier(0)).toBe("dead");
    });

    // ── Boundary conditions ──

    it("exactly at normal threshold is low_compute", () => {
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.normal)).toBe("low_compute");
    });

    it("one cent above normal is normal", () => {
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.normal + 1)).toBe("normal");
    });

    it("exactly at low_compute threshold is critical", () => {
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.low_compute)).toBe("critical");
    });

    it("one cent above low_compute is low_compute", () => {
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.low_compute + 1)).toBe(
        "low_compute",
      );
    });

    it("negative credits are dead", () => {
      expect(getSurvivalTier(-1)).toBe("dead");
      expect(getSurvivalTier(-100)).toBe("dead");
    });
  });

  describe("formatCredits", () => {
    it("formats cents as dollars", () => {
      expect(formatCredits(100)).toBe("$1.00");
      expect(formatCredits(0)).toBe("$0.00");
      expect(formatCredits(50)).toBe("$0.50");
      expect(formatCredits(10_000)).toBe("$100.00");
      expect(formatCredits(1)).toBe("$0.01");
      expect(formatCredits(99)).toBe("$0.99");
    });
  });

  describe("SURVIVAL_THRESHOLDS", () => {
    it("thresholds are in descending order", () => {
      expect(SURVIVAL_THRESHOLDS.normal).toBeGreaterThan(
        SURVIVAL_THRESHOLDS.low_compute,
      );
      expect(SURVIVAL_THRESHOLDS.low_compute).toBeGreaterThanOrEqual(
        SURVIVAL_THRESHOLDS.critical,
      );
      expect(SURVIVAL_THRESHOLDS.critical).toBeGreaterThanOrEqual(
        SURVIVAL_THRESHOLDS.dead,
      );
    });

    it("dead threshold is zero", () => {
      expect(SURVIVAL_THRESHOLDS.dead).toBe(0);
    });

    it("normal threshold represents > $0.50", () => {
      expect(SURVIVAL_THRESHOLDS.normal).toBe(50);
    });
  });
});
