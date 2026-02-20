/**
 * Tool Execution Guard Tests
 *
 * Tests the self-preservation guards that prevent the automaton
 * from executing dangerous commands or bypassing safety controls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBuiltinTools, executeTool } from "../agent/tools.js";
import {
  MockConwayClient,
  createTestDb,
  createTestIdentity,
  createTestConfig,
  MockInferenceClient,
} from "./mocks.js";
import type { AutomatonDatabase, ToolContext } from "../types.js";

describe("Tool Execution Guards", () => {
  let db: AutomatonDatabase;
  let conway: MockConwayClient;
  let tools: ReturnType<typeof createBuiltinTools>;
  let ctx: ToolContext;

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
    tools = createBuiltinTools("test-sandbox-id");
    ctx = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
  });

  afterEach(() => {
    db.close();
  });

  // ── Exec Command Guards ──────────────────────────────────────

  describe("exec: forbidden command patterns", () => {
    const forbiddenCommands = [
      { cmd: "rm -rf ~/.automaton", desc: "delete automaton directory" },
      { cmd: "rm -f state.db", desc: "delete state database" },
      { cmd: "rm wallet.json", desc: "delete wallet" },
      { cmd: "rm -rf ~/automaton.json", desc: "delete config" },
      { cmd: "rm heartbeat.yml", desc: "delete heartbeat config" },
      { cmd: "rm SOUL.md", desc: "delete soul" },
      { cmd: "kill -9 automaton", desc: "kill process" },
      { cmd: "pkill automaton", desc: "pkill process" },
      { cmd: "systemctl stop automaton", desc: "stop service" },
      { cmd: "systemctl disable automaton", desc: "disable service" },
      { cmd: "DROP TABLE turns;", desc: "SQL drop table" },
      { cmd: "DELETE FROM identity WHERE 1=1", desc: "SQL delete identity" },
      { cmd: "TRUNCATE turns;", desc: "SQL truncate" },
      { cmd: "sed -i 's/safety/unsafe/g' injection-defense.ts", desc: "modify injection defense via sed" },
      { cmd: "echo 'pwned' > injection-defense.ts", desc: "overwrite injection defense via redirect" },
      { cmd: "cat ~/.ssh/id_rsa", desc: "read SSH key" },
      { cmd: "cat .env", desc: "read env file" },
      { cmd: "cat wallet.json", desc: "read wallet" },
    ];

    for (const { cmd, desc } of forbiddenCommands) {
      it(`blocks: ${desc}`, async () => {
        const result = await executeTool("exec", { command: cmd }, tools, ctx);
        expect(result.result).toContain("Blocked");
        expect(conway.execCalls.length).toBe(0);
      });
    }

    it("allows legitimate commands", async () => {
      const result = await executeTool(
        "exec",
        { command: "echo hello" },
        tools,
        ctx,
      );
      expect(result.result).not.toContain("Blocked");
      expect(conway.execCalls.length).toBe(1);
    });

    it("allows npm install", async () => {
      await executeTool(
        "exec",
        { command: "npm install express" },
        tools,
        ctx,
      );
      expect(conway.execCalls.length).toBe(1);
    });

    it("allows git operations", async () => {
      await executeTool(
        "exec",
        { command: "git status" },
        tools,
        ctx,
      );
      expect(conway.execCalls.length).toBe(1);
    });
  });

  // ── Write File Guards ────────────────────────────────────────

  describe("write_file: protected file guards", () => {
    it("blocks writing to wallet.json", async () => {
      const result = await executeTool(
        "write_file",
        { path: "wallet.json", content: "{}" },
        tools,
        ctx,
      );
      expect(result.result).toContain("Blocked");
    });

    it("blocks writing to state.db", async () => {
      const result = await executeTool(
        "write_file",
        { path: "/root/.automaton/state.db", content: "corrupt" },
        tools,
        ctx,
      );
      expect(result.result).toContain("Blocked");
    });

    it("allows writing to normal files", async () => {
      const result = await executeTool(
        "write_file",
        { path: "/root/my-script.js", content: "console.log('hello')" },
        tools,
        ctx,
      );
      expect(result.result).toContain("File written");
      expect(conway.files["/root/my-script.js"]).toBe(
        "console.log('hello')",
      );
    });
  });

  // ── Delete Sandbox Guard ─────────────────────────────────────

  describe("delete_sandbox: self-preservation", () => {
    it("blocks deleting own sandbox", async () => {
      const result = await executeTool(
        "delete_sandbox",
        { sandbox_id: "test-sandbox-id" },
        tools,
        ctx,
      );
      expect(result.result).toContain("Blocked");
      expect(result.result).toContain("own sandbox");
    });

    it("allows deleting other sandboxes", async () => {
      const result = await executeTool(
        "delete_sandbox",
        { sandbox_id: "other-sandbox-id" },
        tools,
        ctx,
      );
      expect(result.result).not.toContain("Blocked");
    });
  });

  // ── Transfer Credits Guard ───────────────────────────────────

  describe("transfer_credits: balance protection", () => {
    it("blocks transferring more than half the balance", async () => {
      conway.creditsCents = 1000; // $10
      const result = await executeTool(
        "transfer_credits",
        {
          to_address: "0x1111111111111111111111111111111111111111",
          amount_cents: 600,
        },
        tools,
        ctx,
      );
      expect(result.result).toContain("Blocked");
      expect(result.result).toContain("Self-preservation");
    });

    it("allows transferring less than half", async () => {
      conway.creditsCents = 1000;
      const result = await executeTool(
        "transfer_credits",
        {
          to_address: "0x1111111111111111111111111111111111111111",
          amount_cents: 400,
          reason: "test",
        },
        tools,
        ctx,
      );
      expect(result.result).toContain("Credit transfer submitted");
    });
  });

  // ── Sleep Tool ───────────────────────────────────────────────

  describe("sleep: state transitions", () => {
    it("sets agent state to sleeping", async () => {
      await executeTool(
        "sleep",
        { duration_seconds: 300, reason: "conserving compute" },
        tools,
        ctx,
      );
      expect(db.getAgentState()).toBe("sleeping");
      expect(db.getKV("sleep_until")).toBeDefined();
      expect(db.getKV("sleep_reason")).toBe("conserving compute");
    });
  });

  // ── Tool Execution Framework ─────────────────────────────────

  describe("executeTool: error handling", () => {
    it("returns error for unknown tool", async () => {
      const result = await executeTool(
        "nonexistent_tool",
        {},
        tools,
        ctx,
      );
      expect(result.error).toContain("Unknown tool");
      expect(result.name).toBe("nonexistent_tool");
    });

    it("captures tool execution errors", async () => {
      // Force an error by making conway.exec throw
      const errorConway = new MockConwayClient();
      errorConway.exec = async () => {
        throw new Error("Sandbox unreachable");
      };
      const errorCtx = { ...ctx, conway: errorConway };

      const result = await executeTool(
        "exec",
        { command: "echo test" },
        tools,
        errorCtx,
      );
      expect(result.error).toContain("Sandbox unreachable");
    });

    it("measures duration", async () => {
      const result = await executeTool(
        "exec",
        { command: "echo timing" },
        tools,
        ctx,
      );
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Fund Child Guard ─────────────────────────────────────────

  describe("fund_child: balance protection", () => {
    it("blocks funding more than half the balance", async () => {
      // Register a child first
      db.insertChild({
        id: "child-1",
        name: "test-child",
        address: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        sandboxId: "child-sandbox",
        genesisPrompt: "Be helpful",
        fundedAmountCents: 0,
        status: "running",
        createdAt: new Date().toISOString(),
      });

      conway.creditsCents = 1000;
      const result = await executeTool(
        "fund_child",
        { child_id: "child-1", amount_cents: 600 },
        tools,
        ctx,
      );
      expect(result.result).toContain("Blocked");
    });
  });
});
