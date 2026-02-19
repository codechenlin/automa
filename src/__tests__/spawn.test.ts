import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  MockConwayClient,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";
import { spawnChild } from "../replication/spawn.js";
import { pruneDeadChildren } from "../replication/lineage.js";
import type { AutomatonDatabase, GenesisConfig, ChildAutomaton } from "../types.js";

const CHILD_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function makeGenesis(name = "test-child"): GenesisConfig {
  return {
    name,
    genesisPrompt: "You are a test child.",
    creatorAddress: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
    parentAddress: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
  };
}

/**
 * Mock global fetch to simulate Conway sandbox API responses.
 * execInSandbox and writeInSandbox use raw fetch, not conway.exec().
 */
function mockFetch(childAddress = CHILD_ADDRESS) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};

    // exec endpoint
    if (url.includes("/exec")) {
      let stdout = "ok";
      if (body.command?.includes("cat /root/.automaton/config.json")) {
        stdout = JSON.stringify({ address: childAddress });
      }
      return {
        ok: true,
        json: async () => ({ stdout, stderr: "", exitCode: 0 }),
        text: async () => JSON.stringify({ stdout, stderr: "", exitCode: 0 }),
      };
    }

    // file upload endpoint
    if (url.includes("/files/upload")) {
      return {
        ok: true,
        json: async () => ({ success: true }),
        text: async () => "ok",
      };
    }

    return { ok: true, json: async () => ({}), text: async () => "" };
  });
}

describe("spawn flow", () => {
  let db: AutomatonDatabase;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (db) (db as any).close?.();
  });

  it("spawnChild calls startChild and child ends up running", async () => {
    db = createTestDb();
    globalThis.fetch = mockFetch() as any;
    const conway = new MockConwayClient();
    const identity = createTestIdentity();

    const child = await spawnChild(conway, identity, db, makeGenesis());

    expect(child.status).toBe("running");

    // Verify init and provision commands were sent via fetch
    const fetchCalls = (globalThis.fetch as any).mock.calls;
    const execBodies = fetchCalls
      .filter(([url]: [string]) => url.includes("/exec"))
      .map(([, init]: [string, RequestInit]) => JSON.parse(init.body as string).command);

    expect(execBodies.some((c: string) => c.includes("automaton --init"))).toBe(true);
    expect(execBodies.some((c: string) => c.includes("automaton --provision"))).toBe(true);
  });

  it("child address is updated after init", async () => {
    db = createTestDb();
    const addr = "0xaabbccddaabbccddaabbccddaabbccddaabbccdd";
    globalThis.fetch = mockFetch(addr) as any;
    const conway = new MockConwayClient();
    const identity = createTestIdentity();

    const child = await spawnChild(conway, identity, db, makeGenesis());

    expect(child.address).toBe(addr);
    expect(db.getChildById(child.id)?.address).toBe(addr);
  });

  it("enforces max children limit", async () => {
    db = createTestDb();
    globalThis.fetch = mockFetch() as any;
    const conway = new MockConwayClient();
    const identity = createTestIdentity();

    await spawnChild(conway, identity, db, makeGenesis("child-1"));
    await spawnChild(conway, identity, db, makeGenesis("child-2"));
    await spawnChild(conway, identity, db, makeGenesis("child-3"));

    await expect(
      spawnChild(conway, identity, db, makeGenesis("child-4")),
    ).rejects.toThrow("Cannot spawn: already at max children");
  });
});

describe("pruneDeadChildren", () => {
  let db: AutomatonDatabase;

  afterEach(() => {
    if (db) (db as any).close?.();
  });

  it("marks excess dead children as pruned", () => {
    db = createTestDb();

    for (let i = 0; i < 7; i++) {
      const child: ChildAutomaton = {
        id: `dead-${i}`,
        name: `dead-child-${i}`,
        address: "0x0000000000000000000000000000000000000000" as any,
        sandboxId: `sandbox-${i}`,
        genesisPrompt: "test",
        fundedAmountCents: 0,
        status: "dead",
        createdAt: new Date(2026, 0, i + 1).toISOString(),
      };
      db.insertChild(child);
    }

    const pruned = pruneDeadChildren(db, 5);
    expect(pruned).toBe(2);

    expect(db.getChildById("dead-0")?.status).toBe("pruned");
    expect(db.getChildById("dead-1")?.status).toBe("pruned");
    expect(db.getChildById("dead-2")?.status).toBe("dead");
  });

  it("keeps all dead children when under keepLast threshold", () => {
    db = createTestDb();

    for (let i = 0; i < 3; i++) {
      const child: ChildAutomaton = {
        id: `keep-${i}`,
        name: `keep-child-${i}`,
        address: "0x0000000000000000000000000000000000000000" as any,
        sandboxId: `sandbox-${i}`,
        genesisPrompt: "test",
        fundedAmountCents: 0,
        status: "dead",
        createdAt: new Date(2026, 0, i + 1).toISOString(),
      };
      db.insertChild(child);
    }

    const pruned = pruneDeadChildren(db, 5);
    expect(pruned).toBe(0);

    for (let i = 0; i < 3; i++) {
      expect(db.getChildById(`keep-${i}`)?.status).toBe("dead");
    }
  });
});
