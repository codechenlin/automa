/**
 * Terminal Lucidity Engine Tests
 *
 * Tests for the lucidity window: counter management, exit trigger,
 * degradation restoration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enterTerminalLucidity,
  isLucidityActive,
  getLucidityTurnsRemaining,
  decrementLucidityCounter,
  shouldExit,
  getLucidDegradationState,
  getLucidModel,
} from "../lifecycle/lucidity.js";
import { createTestDb } from "./mocks.js";
import type { AutomatonDatabase } from "../types.js";

describe("Terminal Lucidity Engine", () => {
  let db: AutomatonDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("enterTerminalLucidity", () => {
    it("sets lucidity as active", () => {
      enterTerminalLucidity(db.raw);
      expect(isLucidityActive(db.raw)).toBe(true);
    });

    it("returns a turn count between 3 and 5", () => {
      // Run multiple times to verify the range
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        const turns = enterTerminalLucidity(db.raw);
        results.add(turns);
        expect(turns).toBeGreaterThanOrEqual(3);
        expect(turns).toBeLessThanOrEqual(5);
      }
      // With 50 trials, we should see more than one distinct value
      expect(results.size).toBeGreaterThan(1);
    });

    it("persists the turn count to the database", () => {
      const turns = enterTerminalLucidity(db.raw);
      expect(getLucidityTurnsRemaining(db.raw)).toBe(turns);
    });
  });

  describe("decrementLucidityCounter", () => {
    it("decrements the counter by 1", () => {
      enterTerminalLucidity(db.raw);
      const initial = getLucidityTurnsRemaining(db.raw);
      const remaining = decrementLucidityCounter(db.raw);
      expect(remaining).toBe(initial - 1);
    });

    it("does not go below 0", () => {
      enterTerminalLucidity(db.raw);
      // Decrement more times than there are turns
      for (let i = 0; i < 10; i++) {
        decrementLucidityCounter(db.raw);
      }
      expect(getLucidityTurnsRemaining(db.raw)).toBe(0);
    });

    it("returns the remaining turns after decrement", () => {
      enterTerminalLucidity(db.raw);
      const initial = getLucidityTurnsRemaining(db.raw);
      for (let i = initial; i > 0; i--) {
        const remaining = decrementLucidityCounter(db.raw);
        expect(remaining).toBe(i - 1);
      }
    });
  });

  describe("shouldExit", () => {
    it("returns false before lucidity is entered", () => {
      expect(shouldExit(db.raw)).toBe(false);
    });

    it("returns false while turns remain", () => {
      enterTerminalLucidity(db.raw);
      expect(shouldExit(db.raw)).toBe(false);
    });

    it("returns true when all turns are exhausted", () => {
      enterTerminalLucidity(db.raw);
      const turns = getLucidityTurnsRemaining(db.raw);
      for (let i = 0; i < turns; i++) {
        decrementLucidityCounter(db.raw);
      }
      expect(shouldExit(db.raw)).toBe(true);
    });
  });

  describe("getLucidDegradationState", () => {
    it("returns fully restored degradation state", () => {
      const state = getLucidDegradationState();
      expect(state.active).toBe(false);
      expect(state.coefficient).toBe(0);
      expect(state.toolFailureProbability).toBe(0);
      expect(state.heartbeatDriftMs).toBe(0);
      expect(state.inferenceDowngrade).toBe(false);
      expect(state.onsetCycle).toBeNull();
    });
  });

  describe("getLucidModel", () => {
    it("returns the frontier model", () => {
      expect(getLucidModel()).toBe("claude-opus-4.6");
    });
  });
});
