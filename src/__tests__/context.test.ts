/**
 * Context Window Management Tests
 *
 * Tests for the conversation history builder that feeds
 * context to the inference model each turn.
 */

import { describe, it, expect } from "vitest";
import {
  buildContextMessages,
  trimContext,
} from "../agent/context.js";
import type { AgentTurn, ChatMessage } from "../types.js";

function makeTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: `turn_${Date.now()}_${Math.random()}`,
    timestamp: new Date().toISOString(),
    state: "running",
    thinking: "I am thinking about what to do.",
    toolCalls: [],
    tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    costCents: 1,
    ...overrides,
  };
}

describe("Context Management", () => {
  // ── buildContextMessages ─────────────────────────────────────

  describe("buildContextMessages", () => {
    it("starts with system prompt", () => {
      const messages = buildContextMessages("You are an automaton.", []);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("You are an automaton.");
    });

    it("includes turn history", () => {
      const turns = [
        makeTurn({
          input: "Wake up!",
          inputSource: "wakeup",
          thinking: "I should check my status.",
        }),
      ];
      const messages = buildContextMessages("System.", turns);
      // system + user (input) + assistant (thinking)
      expect(messages.length).toBe(3);
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Wake up!");
      expect(messages[2].role).toBe("assistant");
      expect(messages[2].content).toContain("check my status");
    });

    it("includes tool calls and results", () => {
      const turns = [
        makeTurn({
          thinking: "Let me check credits.",
          toolCalls: [
            {
              id: "tc_1",
              name: "check_credits",
              arguments: {},
              result: "Credit balance: $1.00",
              durationMs: 100,
            },
          ],
        }),
      ];
      const messages = buildContextMessages("System.", turns);
      // system + assistant (with tool_calls) + tool result
      const assistantMsg = messages.find(
        (m) => m.role === "assistant" && m.tool_calls,
      );
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.tool_calls![0].function.name).toBe(
        "check_credits",
      );

      const toolMsg = messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain("$1.00");
    });

    it("includes tool errors", () => {
      const turns = [
        makeTurn({
          thinking: "Check something.",
          toolCalls: [
            {
              id: "tc_err",
              name: "exec",
              arguments: { command: "broken" },
              result: "",
              durationMs: 50,
              error: "Command failed",
            },
          ],
        }),
      ];
      const messages = buildContextMessages("System.", turns);
      const toolMsg = messages.find((m) => m.role === "tool");
      expect(toolMsg!.content).toContain("Error: Command failed");
    });

    it("appends pending input at the end", () => {
      const messages = buildContextMessages("System.", [], {
        content: "New message from creator",
        source: "creator",
      });
      const last = messages[messages.length - 1];
      expect(last.role).toBe("user");
      expect(last.content).toContain("creator");
      expect(last.content).toContain("New message from creator");
    });

    it("adds anti-repetition warning for repeated tools", () => {
      // Create 5 turns all calling the same tool
      const turns = Array.from({ length: 5 }, () =>
        makeTurn({
          toolCalls: [
            {
              id: `tc_${Math.random()}`,
              name: "check_credits",
              arguments: {},
              result: "$1.00",
              durationMs: 50,
            },
          ],
        }),
      );

      const messages = buildContextMessages("System.", turns);
      const warningMsg = messages.find(
        (m) =>
          m.role === "user" &&
          m.content.includes("WARNING") &&
          m.content.includes("check_credits"),
      );
      expect(warningMsg).toBeDefined();
      expect(warningMsg!.content).toContain("repeatedly");
    });

    it("no anti-repetition warning for diverse tool usage", () => {
      const turns = Array.from({ length: 5 }, (_, i) =>
        makeTurn({
          toolCalls: [
            {
              id: `tc_${i}`,
              name: `tool_${i}`,
              arguments: {},
              result: "ok",
              durationMs: 50,
            },
          ],
        }),
      );

      const messages = buildContextMessages("System.", turns);
      const warningMsg = messages.find(
        (m) => m.role === "user" && m.content.includes("WARNING"),
      );
      expect(warningMsg).toBeUndefined();
    });
  });

  // ── trimContext ──────────────────────────────────────────────

  describe("trimContext", () => {
    it("returns all turns when under limit", () => {
      const turns = Array.from({ length: 5 }, () => makeTurn());
      expect(trimContext(turns, 20)).toHaveLength(5);
    });

    it("trims to most recent turns when over limit", () => {
      const turns = Array.from({ length: 30 }, (_, i) =>
        makeTurn({ id: `turn_${i}` }),
      );
      const trimmed = trimContext(turns, 10);
      expect(trimmed).toHaveLength(10);
      // Should keep the most recent (last) turns
      expect(trimmed[0].id).toBe("turn_20");
      expect(trimmed[9].id).toBe("turn_29");
    });

    it("returns empty array for empty input", () => {
      expect(trimContext([])).toHaveLength(0);
    });

    it("uses default max of 20", () => {
      const turns = Array.from({ length: 25 }, () => makeTurn());
      const trimmed = trimContext(turns);
      expect(trimmed).toHaveLength(20);
    });
  });
});
