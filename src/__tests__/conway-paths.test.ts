import { describe, expect, it } from "vitest";
import { resolveSandboxPath, SANDBOX_HOME } from "../conway/paths.js";

describe("resolveSandboxPath", () => {
  it("resolves relative paths under sandbox home", () => {
    expect(resolveSandboxPath("notes/todo.md")).toBe(`${SANDBOX_HOME}/notes/todo.md`);
  });

  it("resolves tilde paths under sandbox home", () => {
    expect(resolveSandboxPath("~/projects/app.py")).toBe(`${SANDBOX_HOME}/projects/app.py`);
  });

  it("leaves absolute paths absolute", () => {
    expect(resolveSandboxPath("/var/log/app.log")).toBe("/var/log/app.log");
  });

  it("normalizes dot and parent segments", () => {
    expect(resolveSandboxPath("~/a/./b/../c.txt")).toBe(`${SANDBOX_HOME}/a/c.txt`);
  });
});
