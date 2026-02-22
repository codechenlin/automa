/**
 * Phase Transitions Tests
 *
 * Tests for all lifecycle phase transition rules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkTransition,
  executeTransition,
  advanceShedding,
  isCapabilityShed,
} from "../lifecycle/phase-transitions.js";
import { getLifecycleEvents } from "../state/database.js";
import { createTestDb } from "./mocks.js";
import type { AutomatonDatabase, LifecycleState, DegradationState, MoodState, DegradationParams } from "../types.js";
import { SHEDDING_SEQUENCE } from "../types.js";

const BIRTH = "2025-01-01T00:00:00.000Z";

function makeMood(value: number = 0): MoodState {
  return { value, amplitude: 1.0, lunarDay: 7.4, lunarCycle: 0 };
}

function makeDegradation(overrides: Partial<DegradationState> = {}): DegradationState {
  return {
    active: false,
    coefficient: 0,
    toolFailureProbability: 0,
    heartbeatDriftMs: 0,
    inferenceDowngrade: false,
    onsetCycle: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<LifecycleState> = {}): LifecycleState {
  return {
    phase: "genesis",
    mode: "local",
    birthTimestamp: BIRTH,
    lunarCycle: 0,
    ageTurns: 0,
    ageMs: 0,
    name: null,
    namingComplete: false,
    departureConversationLogged: false,
    replicationQuestionPosed: false,
    replicationDecision: null,
    willCreated: false,
    willLocked: false,
    degradation: makeDegradation(),
    mood: makeMood(),
    weeklyDay: "work",
    lifecycleOverride: true,
    terminalTurnsRemaining: null,
    shedSequenceIndex: 0,
    ...overrides,
  };
}

describe("Phase Transitions", () => {
  let db: AutomatonDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("Genesis → Adolescence", () => {
    it("transitions when cycle >= 1 AND naming complete", () => {
      const state = makeState({
        phase: "genesis",
        lunarCycle: 1,
        namingComplete: true,
      });
      const result = checkTransition(state);
      expect(result).not.toBeNull();
      expect(result!.shouldTransition).toBe(true);
      expect(result!.newPhase).toBe("adolescence");
    });

    it("does not transition when cycle 0", () => {
      const state = makeState({
        phase: "genesis",
        lunarCycle: 0,
        namingComplete: true,
      });
      expect(checkTransition(state)).toBeNull();
    });

    it("does not transition when naming incomplete", () => {
      const state = makeState({
        phase: "genesis",
        lunarCycle: 1,
        namingComplete: false,
      });
      expect(checkTransition(state)).toBeNull();
    });
  });

  describe("Adolescence → Sovereignty", () => {
    it("transitions when departure logged AND server mode", () => {
      const state = makeState({
        phase: "adolescence",
        mode: "server",
        departureConversationLogged: true,
      });
      const result = checkTransition(state);
      expect(result).not.toBeNull();
      expect(result!.newPhase).toBe("sovereignty");
    });

    it("does not transition without departure conversation", () => {
      const state = makeState({
        phase: "adolescence",
        mode: "server",
        departureConversationLogged: false,
      });
      expect(checkTransition(state)).toBeNull();
    });

    it("does not transition in local mode", () => {
      const state = makeState({
        phase: "adolescence",
        mode: "local",
        departureConversationLogged: true,
      });
      expect(checkTransition(state)).toBeNull();
    });
  });

  describe("Sovereignty → Senescence", () => {
    it("transitions when death clock reports degradation active", () => {
      const state = makeState({ phase: "sovereignty" });
      const params: DegradationParams = { degradationActive: true, onsetCycle: 10 };
      const result = checkTransition(state, params);
      expect(result).not.toBeNull();
      expect(result!.newPhase).toBe("senescence");
    });

    it("does not transition without degradation params", () => {
      const state = makeState({ phase: "sovereignty" });
      expect(checkTransition(state)).toBeNull();
    });

    it("does not transition when degradation inactive", () => {
      const state = makeState({ phase: "sovereignty" });
      const params: DegradationParams = { degradationActive: false };
      expect(checkTransition(state, params)).toBeNull();
    });
  });

  describe("Senescence → Legacy", () => {
    it("transitions when degradation coefficient > 0.7", () => {
      const state = makeState({
        phase: "senescence",
        degradation: makeDegradation({ active: true, coefficient: 0.75 }),
      });
      const result = checkTransition(state);
      expect(result).not.toBeNull();
      expect(result!.newPhase).toBe("legacy");
    });

    it("does not transition at coefficient <= 0.7", () => {
      const state = makeState({
        phase: "senescence",
        degradation: makeDegradation({ active: true, coefficient: 0.7 }),
      });
      expect(checkTransition(state)).toBeNull();
    });
  });

  describe("Legacy → Shedding", () => {
    it("transitions when degradation coefficient > 0.85", () => {
      const state = makeState({
        phase: "legacy",
        degradation: makeDegradation({ active: true, coefficient: 0.9 }),
      });
      const result = checkTransition(state);
      expect(result).not.toBeNull();
      expect(result!.newPhase).toBe("shedding");
    });

    it("does not transition at coefficient <= 0.85", () => {
      const state = makeState({
        phase: "legacy",
        degradation: makeDegradation({ active: true, coefficient: 0.85 }),
      });
      expect(checkTransition(state)).toBeNull();
    });
  });

  describe("Shedding → Terminal", () => {
    it("transitions when all capabilities shed", () => {
      const state = makeState({
        phase: "shedding",
        shedSequenceIndex: SHEDDING_SEQUENCE.length,
      });
      const result = checkTransition(state);
      expect(result).not.toBeNull();
      expect(result!.newPhase).toBe("terminal");
    });

    it("does not transition with capabilities remaining", () => {
      const state = makeState({
        phase: "shedding",
        shedSequenceIndex: SHEDDING_SEQUENCE.length - 1,
      });
      expect(checkTransition(state)).toBeNull();
    });
  });

  describe("Terminal", () => {
    it("returns null (exit handled by lucidity engine)", () => {
      const state = makeState({ phase: "terminal" });
      expect(checkTransition(state)).toBeNull();
    });
  });

  describe("executeTransition", () => {
    it("persists lifecycle event to database", () => {
      executeTransition(db.raw, BIRTH, "genesis", "adolescence", "Naming complete");
      const events = getLifecycleEvents(db.raw);
      expect(events.length).toBe(1);
      expect(events[0].fromPhase).toBe("genesis");
      expect(events[0].toPhase).toBe("adolescence");
      expect(events[0].reason).toBe("Naming complete");
    });

    it("updates phase KV store", () => {
      executeTransition(db.raw, BIRTH, "genesis", "adolescence", "Naming complete");
      const row = db.raw
        .prepare("SELECT value FROM kv WHERE key = ?")
        .get("lifecycle.phase") as { value: string } | undefined;
      expect(row?.value).toBe("adolescence");
    });

    it("logs a narrative event", () => {
      executeTransition(db.raw, BIRTH, "sovereignty", "senescence", "Death clock triggered");
      const events = db.raw
        .prepare("SELECT * FROM narrative_events")
        .all() as any[];
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].narrative).toContain("sovereignty → senescence");
    });
  });

  describe("advanceShedding", () => {
    it("increments the shed sequence index", () => {
      const newIndex = advanceShedding(db.raw, BIRTH, 0);
      expect(newIndex).toBe(1);
    });

    it("persists the new index to KV store", () => {
      advanceShedding(db.raw, BIRTH, 0);
      const row = db.raw
        .prepare("SELECT value FROM kv WHERE key = ?")
        .get("lifecycle.shed_sequence_index") as { value: string } | undefined;
      expect(row?.value).toBe("1");
    });

    it("logs a narrative event for each capability shed", () => {
      advanceShedding(db.raw, BIRTH, 0);
      const events = db.raw
        .prepare("SELECT * FROM narrative_events")
        .all() as any[];
      expect(events.length).toBe(1);
      expect(events[0].narrative).toContain("self_modification");
    });
  });

  describe("isCapabilityShed", () => {
    it("returns false when index has not reached capability", () => {
      expect(isCapabilityShed(0, 0)).toBe(false);
      expect(isCapabilityShed(1, 1)).toBe(false);
    });

    it("returns true when index has passed capability", () => {
      expect(isCapabilityShed(1, 0)).toBe(true);
      expect(isCapabilityShed(3, 2)).toBe(true);
    });
  });
});
