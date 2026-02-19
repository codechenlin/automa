/**
 * automaton-cli dashboard
 *
 * Launch the local Next.js dashboard package.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(3);
const port = parsePort(readArg("--port") || "3747");
const host = "127.0.0.1";

if (!port) {
  console.error("Invalid --port value. Use a number between 1 and 65535.");
  process.exit(1);
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const dashboardDir = path.join(repoRoot, "packages", "dashboard");

if (!fs.existsSync(path.join(dashboardDir, "package.json"))) {
  console.error(`Dashboard package not found at ${dashboardDir}`);
  process.exit(1);
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  pnpmCommand,
  ["exec", "next", "dev", "--port", String(port), "--hostname", host],
  {
    cwd: dashboardDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);

child.on("error", (err) => {
  console.error(`Failed to launch dashboard: ${err.message}`);
  console.error("Make sure pnpm is installed and dependencies are installed in this repo.");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

const forwardSignal = (signal: NodeJS.Signals) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

function readArg(flag: string): string | undefined {
  const exactIndex = args.indexOf(flag);
  if (exactIndex !== -1 && args[exactIndex + 1]) {
    return args[exactIndex + 1];
  }

  const prefix = `${flag}=`;
  const withEquals = args.find((arg) => arg.startsWith(prefix));
  if (withEquals) {
    return withEquals.slice(prefix.length);
  }

  return undefined;
}

function parsePort(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}
