import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockConwayClient } from "./mocks.js";
import { ensureSandbox, syncStateToSandbox } from "../conway/sandbox-provision.js";
import type { AutomatonConfig } from "../types.js";
import { DEFAULT_CONFIG, DEFAULT_MODEL_STRATEGY_CONFIG, DEFAULT_SOUL_CONFIG, DEFAULT_TREASURY_POLICY } from "../types.js";

function makeConfig(): AutomatonConfig {
  return {
    name: "GENESIS",
    genesisPrompt: "test",
    creatorAddress: "0x0000000000000000000000000000000000000001",
    registeredWithConway: true,
    sandboxId: "",
    conwayApiUrl: "https://api.conway.tech",
    conwayApiKey: "cnwy_k_test",
    inferenceModel: "gpt-5.2",
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: "~/.automaton/heartbeat.yml",
    dbPath: "~/.automaton/state.db",
    logLevel: "info",
    walletAddress: "0x0000000000000000000000000000000000000002",
    version: "0.1.0",
    skillsDir: "~/.automaton/skills",
    maxChildren: 3,
    socialRelayUrl: DEFAULT_CONFIG.socialRelayUrl,
    treasuryPolicy: DEFAULT_TREASURY_POLICY,
    modelStrategy: DEFAULT_MODEL_STRATEGY_CONFIG,
    soulConfig: DEFAULT_SOUL_CONFIG,
  };
}

describe("ensureSandbox", () => {
  it("adopts an existing running sandbox", async () => {
    const conway = new MockConwayClient();
    vi.spyOn(conway, "listSandboxes").mockResolvedValue([
      {
        id: "stopped-one",
        status: "stopped",
        region: "us-east",
        vcpu: 1,
        memoryMb: 512,
        diskGb: 5,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "running-new",
        status: "running",
        region: "us-east",
        vcpu: 1,
        memoryMb: 512,
        diskGb: 5,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    const createSpy = vi.spyOn(conway, "createSandbox");

    const selected = await ensureSandbox(conway, makeConfig());

    expect(selected.id).toBe("running-new");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("creates a new sandbox when none are running", async () => {
    const conway = new MockConwayClient();
    vi.spyOn(conway, "listSandboxes").mockResolvedValue([]);
    const createSpy = vi.spyOn(conway, "createSandbox");

    const created = await ensureSandbox(conway, makeConfig());

    expect(created.id).toBe("new-sandbox-id");
    expect(createSpy).toHaveBeenCalledOnce();
  });
});

describe("syncStateToSandbox", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("syncs allowed files and skill docs, excludes sensitive files", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "automaton-sync-"));
    tempDirs.push(base);
    fs.mkdirSync(path.join(base, "skills", "research"), { recursive: true });

    fs.writeFileSync(path.join(base, "constitution.md"), "const");
    fs.writeFileSync(path.join(base, "SOUL.md"), "soul");
    fs.writeFileSync(path.join(base, "WORKLOG.md"), "worklog");
    fs.writeFileSync(path.join(base, "wallet.json"), "secret-wallet");
    fs.writeFileSync(path.join(base, "automaton.json"), "secret-config");
    fs.writeFileSync(path.join(base, "skills", "research", "SKILL.md"), "skill-doc");

    const conway = new MockConwayClient();
    await syncStateToSandbox(conway, { localAutomatonDir: base });

    expect(conway.files["/root/.automaton/constitution.md"]).toBe("const");
    expect(conway.files["/root/.automaton/SOUL.md"]).toBe("soul");
    expect(conway.files["/root/.automaton/WORKLOG.md"]).toBe("worklog");
    expect(conway.files["/root/.automaton/skills/research/SKILL.md"]).toBe("skill-doc");
    expect(conway.files["/root/.automaton/wallet.json"]).toBeUndefined();
    expect(conway.files["/root/.automaton/automaton.json"]).toBeUndefined();
    expect(conway.files["/root/.automaton/.gitignore"]).toContain("wallet.json");
  });
});
