/**
 * Sandbox path resolution for Conway remote sandbox.
 * Single source of truth for sandbox home and path normalization.
 */

import path from "path";

/** Default home directory inside the Conway sandbox VM. */
export const SANDBOX_HOME = "/root";

/** State directory in the sandbox: /root/.automaton */
export const SANDBOX_AUTOMATON_DIR = path.join(SANDBOX_HOME, ".automaton");

/**
 * Resolve a file path to an absolute path in the sandbox.
 * - ~ or ~/... -> SANDBOX_HOME + rest
 * - relative path -> SANDBOX_HOME + path
 * - already absolute -> normalized
 */
export function resolveSandboxPath(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed.startsWith("~")) {
    const rest = trimmed.slice(1).replace(/^\//, "") || "";
    return path.normalize(path.join(SANDBOX_HOME, rest));
  }
  if (!path.isAbsolute(trimmed)) {
    return path.normalize(path.join(SANDBOX_HOME, trimmed));
  }
  return path.normalize(trimmed);
}
