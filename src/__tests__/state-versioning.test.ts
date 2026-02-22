import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConwayClient, ExecResult } from "../types.js";

import { initStateRepo } from "../git/state-versioning.js";

function makeConway(execResult: ExecResult): ConwayClient {
  return {
    exec: vi.fn(async () => execResult),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    exposePort: vi.fn(async () => ({ port: 0, publicUrl: "", sandboxId: "" })),
    removePort: vi.fn(async () => undefined),
    createSandbox: vi.fn(async () => ({
      id: "s",
      status: "running",
      region: "us-east",
      vcpu: 1,
      memoryMb: 512,
      diskGb: 5,
      createdAt: new Date().toISOString(),
    })),
    deleteSandbox: vi.fn(async () => undefined),
    listSandboxes: vi.fn(async () => []),
    getCreditsBalance: vi.fn(async () => 0),
    getCreditsPricing: vi.fn(async () => []),
    transferCredits: vi.fn(async () => ({ transferId: "", status: "", toAddress: "", amountCents: 0 })),
    searchDomains: vi.fn(async () => []),
    registerDomain: vi.fn(async () => ({ domain: "", status: "" })),
    listDnsRecords: vi.fn(async () => []),
    addDnsRecord: vi.fn(async () => ({ id: "", type: "", host: "", value: "" })),
    deleteDnsRecord: vi.fn(async () => undefined),
    listModels: vi.fn(async () => []),
  };
}

describe("initStateRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses provided repoPath when given", async () => {
    const conway = makeConway({ stdout: "exists", stderr: "", exitCode: 0 });

    await initStateRepo(conway, "/root/.automaton");

    expect(conway.exec).toHaveBeenCalledWith(
      'test -d /root/.automaton/.git && echo "exists" || echo "nope"',
      5000,
    );
  });

  it("falls back to local ~/.automaton when repoPath is omitted", async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = "/home/tester";
    const conway = makeConway({ stdout: "exists", stderr: "", exitCode: 0 });

    try {
      await initStateRepo(conway);
      expect(conway.exec).toHaveBeenCalledWith(
        'test -d /home/tester/.automaton/.git && echo "exists" || echo "nope"',
        5000,
      );
    } finally {
      process.env.HOME = prevHome;
    }
  });
});
