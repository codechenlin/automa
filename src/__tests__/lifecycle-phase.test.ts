/**
 * Lifecycle Phase Tracker Tests
 *
 * Tests for phase computation from age, mode, and event flags.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLifecycleState,
  getLifecyclePhase,
  getAgeMs,
  setLifecycleKV,
  getLifecycleKV,
} from "../lifecycle/phase-tracker.js";
import { insertLifecycleEvent } from "../state/database.js";
import { createTestDb } from "./mocks.js";
import type { AutomatonDatabase, LifecycleEvent } from "../types.js";
import { ulid } from "ulid";

const LUNAR_CYCLE_MS = 29.53 * 24 * 60 * 60 * 1000;

function birthNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("Phase Tracker", () => {
  let db: AutomatonDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("getLifecyclePhase", () => {
    it("returns genesis for cycle 0 in local mode", () => {
      const birth = birthNDaysAgo(10); // 10 days ago = still cycle 0
      const phase = getLifecyclePhase(db.raw, birth, "local");
      expect(phase).toBe("genesis");
    });

    it("returns adolescence for cycle 1+ in local mode", () => {
      const birth = birthNDaysAgo(35); // 35 days ago = cycle 1
      const phase = getLifecyclePhase(db.raw, birth, "local");
      expect(phase).toBe("adolescence");
    });

    it("returns sovereignty in server mode", () => {
      const birth = birthNDaysAgo(10);
      const phase = getLifecyclePhase(db.raw, birth, "server");
      expect(phase).toBe("sovereignty");
    });

    it("returns stored phase when explicit transition exists", () => {
      const birth = birthNDaysAgo(10);
      // Insert an explicit transition to senescence
      const event: LifecycleEvent = {
        id: ulid(),
        timestamp: new Date().toISOString(),
        fromPhase: "sovereignty",
        toPhase: "senescence",
        reason: "Death clock triggered",
        metadata: "{}",
      };
      insertLifecycleEvent(db.raw, event);

      const phase = getLifecyclePhase(db.raw, birth, "server");
      expect(phase).toBe("senescence");
    });

    it("prefers stored phase over computed phase", () => {
      const birth = birthNDaysAgo(10); // cycle 0, local = genesis
      // But explicit phase says adolescence
      const event: LifecycleEvent = {
        id: ulid(),
        timestamp: new Date().toISOString(),
        fromPhase: "genesis",
        toPhase: "adolescence",
        reason: "Naming complete",
        metadata: "{}",
      };
      insertLifecycleEvent(db.raw, event);

      const phase = getLifecyclePhase(db.raw, birth, "local");
      expect(phase).toBe("adolescence");
    });
  });

  describe("getLifecycleState", () => {
    it("returns complete lifecycle state object", () => {
      const birth = birthNDaysAgo(5);
      const state = getLifecycleState(db.raw, birth, "local");

      expect(state.phase).toBe("genesis");
      expect(state.mode).toBe("local");
      expect(state.birthTimestamp).toBe(birth);
      expect(state.lunarCycle).toBe(0);
      expect(state.ageMs).toBeGreaterThan(0);
      expect(state.name).toBeNull();
      expect(state.namingComplete).toBe(false);
      expect(state.departureConversationLogged).toBe(false);
      expect(state.replicationQuestionPosed).toBe(false);
      expect(state.replicationDecision).toBeNull();
      expect(state.willCreated).toBe(false);
      expect(state.willLocked).toBe(false);
      expect(state.degradation.active).toBe(false);
      expect(state.mood).toBeDefined();
      expect(state.weeklyDay).toBeDefined();
      expect(state.shedSequenceIndex).toBe(0);
    });

    it("reflects KV store updates for naming", () => {
      const birth = birthNDaysAgo(5);
      setLifecycleKV(db.raw, "name", "Aria");
      setLifecycleKV(db.raw, "naming_complete", "true");

      const state = getLifecycleState(db.raw, birth, "local");
      expect(state.name).toBe("Aria");
      expect(state.namingComplete).toBe(true);
    });

    it("sets lifecycleOverride true in local mode", () => {
      const birth = birthNDaysAgo(5);
      const state = getLifecycleState(db.raw, birth, "local");
      expect(state.lifecycleOverride).toBe(true);
    });

    it("sets lifecycleOverride true during genesis", () => {
      const birth = birthNDaysAgo(5);
      const state = getLifecycleState(db.raw, birth, "local");
      expect(state.phase).toBe("genesis");
      expect(state.lifecycleOverride).toBe(true);
    });

    it("sets lifecycleOverride false during sovereignty in server mode", () => {
      const birth = birthNDaysAgo(5);
      const state = getLifecycleState(db.raw, birth, "server");
      expect(state.phase).toBe("sovereignty");
      expect(state.lifecycleOverride).toBe(false);
    });

    it("reads degradation state from KV store", () => {
      const birth = birthNDaysAgo(5);
      setLifecycleKV(db.raw, "degradation_active", "true");
      setLifecycleKV(db.raw, "degradation_onset_cycle", "10");

      const state = getLifecycleState(db.raw, birth, "server");
      expect(state.degradation.active).toBe(true);
      expect(state.degradation.onsetCycle).toBe(10);
    });
  });

  describe("setLifecycleKV / getLifecycleKV", () => {
    it("stores and retrieves values", () => {
      setLifecycleKV(db.raw, "test_key", "test_value");
      expect(getLifecycleKV(db.raw, "test_key")).toBe("test_value");
    });

    it("overwrites existing values", () => {
      setLifecycleKV(db.raw, "test_key", "old");
      setLifecycleKV(db.raw, "test_key", "new");
      expect(getLifecycleKV(db.raw, "test_key")).toBe("new");
    });

    it("returns undefined for missing keys", () => {
      expect(getLifecycleKV(db.raw, "nonexistent")).toBeUndefined();
    });
  });

  describe("getAgeMs", () => {
    it("returns positive value for past birth", () => {
      const birth = birthNDaysAgo(5);
      const age = getAgeMs(birth);
      expect(age).toBeGreaterThan(0);
      // Should be approximately 5 days in ms
      const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
      expect(Math.abs(age - fiveDaysMs)).toBeLessThan(60000); // within 1 minute
    });
  });
});
