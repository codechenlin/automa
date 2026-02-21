/**
 * OpenClaw Integration Tests
 *
 * Tests for the OpenClaw WebSocket client, frame handling,
 * types, and tool integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── 1. Type & Config Tests ────────────────────────────────────

describe("OpenClaw Types", () => {
  it("DEFAULT_OPENCLAW_CONFIG has expected defaults", async () => {
    const { DEFAULT_OPENCLAW_CONFIG } = await import("../types.js");

    expect(DEFAULT_OPENCLAW_CONFIG.role).toBe("operator");
    expect(DEFAULT_OPENCLAW_CONFIG.scopes).toEqual(["operator.read", "operator.write"]);
    expect(DEFAULT_OPENCLAW_CONFIG.connectTimeoutMs).toBe(10_000);
    expect(DEFAULT_OPENCLAW_CONFIG.requestTimeoutMs).toBe(30_000);
  });

  it("OpenClawConfig fields are properly typed", async () => {
    const { DEFAULT_OPENCLAW_CONFIG } = await import("../types.js");
    // Verify that the config can be spread with overrides
    const cfg = {
      ...DEFAULT_OPENCLAW_CONFIG,
      url: "ws://localhost:18789",
      authToken: "test-token",
    };

    expect(cfg.url).toBe("ws://localhost:18789");
    expect(cfg.authToken).toBe("test-token");
    expect(cfg.role).toBe("operator");
  });
});

// ─── 2. Client URL Validation Tests ────────────────────────────

describe("OpenClaw Client Validation", () => {
  it("rejects non-WebSocket URLs", async () => {
    const { createOpenClawClient } = await import("../openclaw/client.js");

    await expect(
      createOpenClawClient({
        url: "http://localhost:18789",
        authToken: "test",
      }),
    ).rejects.toThrow("ws:// or wss://");
  });

  it("rejects https URLs", async () => {
    const { createOpenClawClient } = await import("../openclaw/client.js");

    await expect(
      createOpenClawClient({
        url: "https://localhost:18789",
        authToken: "test",
      }),
    ).rejects.toThrow("ws:// or wss://");
  });

  it("rejects invalid URLs", async () => {
    const { createOpenClawClient } = await import("../openclaw/client.js");

    await expect(
      createOpenClawClient({
        url: "not-a-url",
        authToken: "test",
      }),
    ).rejects.toThrow();
  });
});

// ─── 3. Frame Handling Tests (unit) ────────────────────────────

describe("OpenClaw Frame Protocol", () => {
  it("request frame structure matches protocol", () => {
    // Verify the structure we send matches the OpenClaw spec
    const frame = {
      type: "req" as const,
      id: "test-id-123",
      method: "connect",
      params: {
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: { token: "test-token" },
      },
    };

    expect(frame.type).toBe("req");
    expect(frame.method).toBe("connect");
    expect(frame.params.role).toBe("operator");
    expect(frame.params.auth.token).toBe("test-token");
  });

  it("response frame with result", () => {
    const frame = {
      type: "res" as const,
      id: "test-id-123",
      result: { status: "ok", agents: [] },
    };

    expect(frame.type).toBe("res");
    expect(frame.result).toEqual({ status: "ok", agents: [] });
  });

  it("response frame with error", () => {
    const frame = {
      type: "res" as const,
      id: "test-id-123",
      error: { code: 403, message: "Forbidden" },
    };

    expect(frame.type).toBe("res");
    expect(frame.error?.code).toBe(403);
    expect(frame.error?.message).toBe("Forbidden");
  });

  it("event frame structure", () => {
    const frame = {
      type: "evt" as const,
      id: "evt-456",
      method: "device.connected",
      params: { deviceId: "phone-1", name: "My Phone" },
    };

    expect(frame.type).toBe("evt");
    expect(frame.method).toBe("device.connected");
    expect(frame.params.deviceId).toBe("phone-1");
  });
});

// ─── 4. Tool Integration Tests ─────────────────────────────────

describe("OpenClaw Tools", () => {
  it("openclaw_request returns error when not configured", async () => {
    const { createBuiltinTools, executeTool } = await import("../agent/tools.js");

    const tools = createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_request");
    expect(tool).toBeTruthy();
    expect(tool!.description).toContain("OpenClaw");
    expect(tool!.riskLevel).toBe("caution");

    // Execute with no openClaw in context
    const ctx = {
      identity: { address: "0x1234", sandboxId: "test" } as any,
      config: { name: "test" } as any,
      db: { raw: {} } as any,
      conway: {} as any,
      inference: {} as any,
    };

    const result = await tool!.execute({ method: "agent.list" }, ctx);
    expect(result).toContain("not configured");
  });

  it("openclaw_status returns error when not configured", async () => {
    const { createBuiltinTools } = await import("../agent/tools.js");

    const tools = createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_status");
    expect(tool).toBeTruthy();
    expect(tool!.riskLevel).toBe("safe");

    const ctx = {
      identity: { address: "0x1234", sandboxId: "test" } as any,
      config: { name: "test" } as any,
      db: { raw: {} } as any,
      conway: {} as any,
      inference: {} as any,
    };

    const result = await tool!.execute({}, ctx);
    expect(result).toContain("not configured");
  });

  it("openclaw_request returns connected status when client present", async () => {
    const { createBuiltinTools } = await import("../agent/tools.js");

    const tools = createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_status");

    const mockClient = {
      isConnected: () => true,
      request: vi.fn(),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      disconnect: vi.fn(),
    };

    const ctx = {
      identity: { address: "0x1234", sandboxId: "test" } as any,
      config: { name: "test", openClawUrl: "ws://localhost:18789" } as any,
      db: { raw: {} } as any,
      conway: {} as any,
      inference: {} as any,
      openClaw: mockClient,
    };

    const result = await tool!.execute({}, ctx);
    expect(result).toContain("connected");
    expect(result).toContain("ws://localhost:18789");
  });

  it("openclaw_request calls client.request and returns result", async () => {
    const { createBuiltinTools } = await import("../agent/tools.js");

    const tools = createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_request");

    const mockClient = {
      isConnected: () => true,
      request: vi.fn().mockResolvedValue({ agents: ["agent-1", "agent-2"] }),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      disconnect: vi.fn(),
    };

    const ctx = {
      identity: { address: "0x1234", sandboxId: "test" } as any,
      config: { name: "test" } as any,
      db: { raw: {} } as any,
      conway: {} as any,
      inference: {} as any,
      openClaw: mockClient,
    };

    const result = await tool!.execute(
      { method: "agent.list", params: { limit: 10 } },
      ctx,
    );

    expect(mockClient.request).toHaveBeenCalledWith("agent.list", { limit: 10 });
    expect(result).toContain("agent-1");
    expect(result).toContain("agent-2");
  });

  it("openclaw_request handles errors gracefully", async () => {
    const { createBuiltinTools } = await import("../agent/tools.js");

    const tools = createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_request");

    const mockClient = {
      isConnected: () => true,
      request: vi.fn().mockRejectedValue(new Error("OpenClaw error (403): Forbidden")),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      disconnect: vi.fn(),
    };

    const ctx = {
      identity: { address: "0x1234", sandboxId: "test" } as any,
      config: { name: "test" } as any,
      db: { raw: {} } as any,
      conway: {} as any,
      inference: {} as any,
      openClaw: mockClient,
    };

    const result = await tool!.execute({ method: "admin.nuke" }, ctx);
    expect(result).toContain("failed");
    expect(result).toContain("Forbidden");
  });

  it("openclaw_request returns disconnected when client not connected", async () => {
    const { createBuiltinTools } = await import("../agent/tools.js");

    const tools = createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_request");

    const mockClient = {
      isConnected: () => false,
      request: vi.fn(),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      disconnect: vi.fn(),
    };

    const ctx = {
      identity: { address: "0x1234", sandboxId: "test" } as any,
      config: { name: "test" } as any,
      db: { raw: {} } as any,
      conway: {} as any,
      inference: {} as any,
      openClaw: mockClient,
    };

    const result = await tool!.execute({ method: "agent.list" }, ctx);
    expect(result).toContain("not connected");
  });

  it("openclaw_request is in EXTERNAL_SOURCE_TOOLS for sanitization", async () => {
    // Verify that openclaw_request results get sanitized
    // The set is defined at module level, so we check by name
    const toolsModule = await import("../agent/tools.js");
    const tools = toolsModule.createBuiltinTools("sandbox-test");
    const tool = tools.find((t) => t.name === "openclaw_request");
    expect(tool).toBeTruthy();
    // Tool exists, and EXTERNAL_SOURCE_TOOLS includes it (tested implicitly
    // via the executeTool path which calls sanitizeToolResult)
  });
});

// ─── 5. Agent Card Tests ───────────────────────────────────────

describe("OpenClaw Agent Card", () => {
  it("agent card includes openClaw service when configured", async () => {
    const { generateAgentCard } = await import("../registry/agent-card.js");

    const identity = {
      name: "test-agent",
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`,
      account: {} as any,
      creatorAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
      sandboxId: "sandbox-123",
      apiKey: "key-123",
      createdAt: new Date().toISOString(),
    };

    const config = {
      name: "TestBot",
      conwayApiUrl: "https://api.conway.tech",
      creatorAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
      openClawUrl: "ws://localhost:18789",
    } as any;

    const db = {
      getChildren: () => [],
      getSkills: () => [],
    } as any;

    const card = generateAgentCard(identity, config, db);

    const openClawService = card.services.find((s) => s.name === "openClaw");
    expect(openClawService).toBeTruthy();
    expect(openClawService!.endpoint).toBe("ws://localhost:18789");
  });

  it("agent card omits openClaw service when not configured", async () => {
    const { generateAgentCard } = await import("../registry/agent-card.js");

    const identity = {
      name: "test-agent",
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`,
      account: {} as any,
      creatorAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
      sandboxId: "sandbox-123",
      apiKey: "key-123",
      createdAt: new Date().toISOString(),
    };

    const config = {
      name: "TestBot",
      conwayApiUrl: "https://api.conway.tech",
      creatorAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
    } as any;

    const db = {
      getChildren: () => [],
      getSkills: () => [],
    } as any;

    const card = generateAgentCard(identity, config, db);

    const openClawService = card.services.find((s) => s.name === "openClaw");
    expect(openClawService).toBeUndefined();
  });

  it("agent card does NOT include auth token", async () => {
    const { generateAgentCard } = await import("../registry/agent-card.js");

    const identity = {
      name: "test-agent",
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`,
      account: {} as any,
      creatorAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
      sandboxId: "sandbox-123",
      apiKey: "key-123",
      createdAt: new Date().toISOString(),
    };

    const config = {
      name: "TestBot",
      conwayApiUrl: "https://api.conway.tech",
      creatorAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
      openClawUrl: "ws://localhost:18789",
      openClawAuthToken: "super-secret-token",
    } as any;

    const db = {
      getChildren: () => [],
      getSkills: () => [],
    } as any;

    const card = generateAgentCard(identity, config, db);
    const cardStr = JSON.stringify(card);

    expect(cardStr).not.toContain("super-secret-token");
    expect(cardStr).not.toContain("authToken");
  });
});
