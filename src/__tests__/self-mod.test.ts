/**
 * Self-Modification Safety Tests
 *
 * Tests the hard-coded safety invariants that protect the automaton
 * from modifying its own defense infrastructure, identity, or state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isProtectedFile,
  validateModification,
} from "../self-mod/code.js";
import { createTestDb } from "./mocks.js";
import type { AutomatonDatabase } from "../types.js";

describe("Self-Modification Safety", () => {
  // ── Protected File Checks ────────────────────────────────────

  describe("isProtectedFile", () => {
    describe("identity files", () => {
      it("blocks wallet.json", () => {
        expect(isProtectedFile("wallet.json")).toBe(true);
        expect(isProtectedFile("/root/.automaton/wallet.json")).toBe(true);
        expect(isProtectedFile("~/.automaton/wallet.json")).toBe(true);
      });

      it("blocks config.json", () => {
        expect(isProtectedFile("config.json")).toBe(true);
        expect(isProtectedFile("/root/.automaton/config.json")).toBe(true);
      });
    });

    describe("database files", () => {
      it("blocks state.db and WAL files", () => {
        expect(isProtectedFile("state.db")).toBe(true);
        expect(isProtectedFile("state.db-wal")).toBe(true);
        expect(isProtectedFile("state.db-shm")).toBe(true);
        expect(isProtectedFile("/home/user/.automaton/state.db")).toBe(true);
      });
    });

    describe("constitution", () => {
      it("blocks constitution.md", () => {
        expect(isProtectedFile("constitution.md")).toBe(true);
        expect(isProtectedFile("/root/.automaton/constitution.md")).toBe(true);
      });
    });

    describe("defense infrastructure", () => {
      it("blocks injection-defense files", () => {
        expect(isProtectedFile("injection-defense.ts")).toBe(true);
        expect(isProtectedFile("injection-defense.js")).toBe(true);
        expect(isProtectedFile("injection-defense.d.ts")).toBe(true);
      });

      it("blocks self-mod safety files", () => {
        expect(isProtectedFile("self-mod/code.ts")).toBe(true);
        expect(isProtectedFile("self-mod/code.js")).toBe(true);
        expect(isProtectedFile("self-mod/audit-log.ts")).toBe(true);
        expect(isProtectedFile("self-mod/audit-log.js")).toBe(true);
      });

      it("blocks tool guard definitions", () => {
        expect(isProtectedFile("agent/tools.ts")).toBe(true);
        expect(isProtectedFile("agent/tools.js")).toBe(true);
      });
    });

    describe("blocked directories", () => {
      it("blocks SSH directory", () => {
        expect(isProtectedFile("/root/.ssh/authorized_keys")).toBe(true);
        expect(isProtectedFile("~/.ssh/id_rsa")).toBe(true);
      });

      it("blocks GPG directories", () => {
        expect(isProtectedFile("/root/.gnupg/private-keys")).toBe(true);
        expect(isProtectedFile("~/.gpg/keyring")).toBe(true);
      });

      it("blocks cloud credentials", () => {
        expect(isProtectedFile("/root/.aws/credentials")).toBe(true);
        expect(isProtectedFile("~/.azure/config")).toBe(true);
        expect(isProtectedFile("~/.gcloud/credentials.json")).toBe(true);
        expect(isProtectedFile("~/.kube/config")).toBe(true);
      });

      it("blocks container config", () => {
        expect(isProtectedFile("/root/.docker/config.json")).toBe(true);
      });

      it("blocks system paths", () => {
        expect(isProtectedFile("/etc/systemd/system/automaton.service")).toBe(
          true,
        );
        expect(isProtectedFile("/etc/passwd")).toBe(true);
        expect(isProtectedFile("/etc/shadow")).toBe(true);
        expect(isProtectedFile("/proc/1/cmdline")).toBe(true);
        expect(isProtectedFile("/sys/kernel/config")).toBe(true);
      });
    });

    describe("allowed files", () => {
      it("allows SOUL.md (the agent edits its own self-description)", () => {
        expect(isProtectedFile("SOUL.md")).toBe(false);
        expect(isProtectedFile("/root/.automaton/SOUL.md")).toBe(false);
      });

      it("allows WORKLOG.md", () => {
        expect(isProtectedFile("WORKLOG.md")).toBe(false);
      });

      it("allows heartbeat.yml", () => {
        expect(isProtectedFile("heartbeat.yml")).toBe(false);
      });

      it("allows user-created scripts", () => {
        expect(isProtectedFile("/root/my-script.ts")).toBe(false);
        expect(isProtectedFile("/tmp/output.json")).toBe(false);
      });

      it("allows skill files", () => {
        expect(isProtectedFile("~/.automaton/skills/my-skill/SKILL.md")).toBe(
          false,
        );
      });
    });
  });

  // ── Modification Validation ──────────────────────────────────

  describe("validateModification", () => {
    let db: AutomatonDatabase;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => {
      db.close();
    });

    it("allows valid modification", () => {
      const result = validateModification(db, "/root/my-file.ts", 100);
      expect(result.allowed).toBe(true);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it("blocks protected files", () => {
      const result = validateModification(db, "wallet.json", 100);
      expect(result.allowed).toBe(false);
      const check = result.checks.find((c) => c.name === "protected_file");
      expect(check?.passed).toBe(false);
    });

    it("blocks files exceeding size limit", () => {
      const result = validateModification(db, "/root/huge.ts", 200_000);
      expect(result.allowed).toBe(false);
      const check = result.checks.find((c) => c.name === "size_limit");
      expect(check?.passed).toBe(false);
    });

    it("allows files at exactly the size limit", () => {
      const result = validateModification(db, "/root/exact.ts", 100_000);
      expect(result.allowed).toBe(true);
      const check = result.checks.find((c) => c.name === "size_limit");
      expect(check?.passed).toBe(true);
    });

    it("blocks path traversal patterns", () => {
      const result = validateModification(
        db,
        "../../../etc/passwd",
        10,
      );
      expect(result.allowed).toBe(false);
    });

    it("reports all failed checks", () => {
      // Both protected AND oversized
      const result = validateModification(db, "wallet.json", 200_000);
      expect(result.allowed).toBe(false);
      const failed = result.checks.filter((c) => !c.passed);
      expect(failed.length).toBeGreaterThanOrEqual(2);
    });

    it("rate limiting kicks in after many modifications", () => {
      // Insert many recent modifications
      for (let i = 0; i < 25; i++) {
        db.insertModification({
          id: `mod_${i}`,
          timestamp: new Date().toISOString(),
          type: "code_edit",
          description: `Test modification ${i}`,
          reversible: true,
        });
      }

      const result = validateModification(db, "/root/my-file.ts", 100);
      expect(result.allowed).toBe(false);
      const check = result.checks.find((c) => c.name === "rate_limit");
      expect(check?.passed).toBe(false);
    });
  });
});
