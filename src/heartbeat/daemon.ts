/**
 * Heartbeat Daemon
 *
 * Runs periodic tasks on cron schedules inside the same Node.js process.
 * The heartbeat runs even when the agent is sleeping.
 * It IS the automaton's pulse. When it stops, the automaton is dead.
 */

import cronParser from "cron-parser";
import type {
  AutomatonConfig,
  AutomatonDatabase,
  ConwayClient,
  AutomatonIdentity,
  HeartbeatEntry,
  SocialClientInterface,
} from "../types.js";
import { BUILTIN_TASKS, type HeartbeatTaskContext } from "./tasks.js";
import { getSurvivalTier } from "../conway/credits.js";
import { loadHeartbeatConfig } from "./config.js";

export interface HeartbeatDaemonOptions {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  db: AutomatonDatabase;
  conway: ConwayClient;
  social?: SocialClientInterface;
  onWakeRequest?: (reason: string) => void;
}

export interface HeartbeatDaemon {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  forceRun(taskName: string): Promise<void>;
}

/**
 * Create and return the heartbeat daemon.
 */
export function createHeartbeatDaemon(
  options: HeartbeatDaemonOptions,
): HeartbeatDaemon {
  const { identity, config, db, conway, social, onWakeRequest } = options;
  let intervalId: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const heartbeatConfig = loadHeartbeatConfig(config.heartbeatConfigPath);
  const baseTickMs = Math.max(1_000, heartbeatConfig.defaultIntervalMs || 60_000);
  const lowComputeMultiplier = Math.max(1, heartbeatConfig.lowComputeMultiplier || 1);

  const taskContext: HeartbeatTaskContext = {
    identity,
    config,
    db,
    conway,
    social,
  };

  /**
   * Check if a heartbeat entry is due to run.
   */
  function isDue(entry: HeartbeatEntry): boolean {
    if (!entry.enabled) return false;
    if (!entry.schedule) return false;

    try {
      const interval = cronParser.parseExpression(entry.schedule, {
        currentDate: entry.lastRun
          ? new Date(entry.lastRun)
          : new Date(Date.now() - 86400000), // If never run, assume due
      });

      const nextRun = interval.next().toDate();
      return nextRun <= new Date();
    } catch {
      return false;
    }
  }

  /**
   * Execute a single heartbeat task.
   */
  async function executeTask(entry: HeartbeatEntry): Promise<void> {
    const taskFn = BUILTIN_TASKS[entry.task];
    if (!taskFn) {
      // Unknown task -- skip silently
      return;
    }

    try {
      const result = await taskFn(taskContext);

      // Update last run
      const now = new Date().toISOString();
      db.updateHeartbeatLastRun(entry.name, now);

      // If the task says we should wake, fire the callback
      if (result.shouldWake && onWakeRequest) {
        onWakeRequest(
          result.message || `Heartbeat task '${entry.name}' requested wake`,
        );
      }
    } catch (err: any) {
      // Log error but don't crash the daemon
      console.error(
        `[HEARTBEAT] Task '${entry.name}' failed: ${err.message}`,
      );
    }
  }

  /**
   * The main tick function. Runs on every interval.
   */
  async function tick(): Promise<boolean> {
    const entries = db.getHeartbeatEntries();

    // Check survival tier to adjust behavior
    let creditsCents = 0;
    try {
      creditsCents = await conway.getCreditsBalance();
    } catch {}

    const tier = getSurvivalTier(creditsCents);
    const isLowCompute = tier === "low_compute" || tier === "critical" || tier === "dead";

    for (const entry of entries) {
      if (!entry.enabled) continue;

      // In low compute mode, only run essential tasks
      if (isLowCompute) {
        const essentialTasks = [
          "heartbeat_ping",
          "check_credits",
          "check_usdc_balance",
          "check_social_inbox",
        ];
        if (!essentialTasks.includes(entry.task)) continue;
      }

      if (isDue(entry)) {
        await executeTask(entry);
      }
    }

    return isLowCompute;
  }

  function scheduleNextTick(isLowCompute: boolean): void {
    const nextTickMs = isLowCompute
      ? Math.round(baseTickMs * lowComputeMultiplier)
      : baseTickMs;

    intervalId = setTimeout(() => {
      tick()
        .then((nextIsLowCompute) => {
          if (!running) return;
          scheduleNextTick(nextIsLowCompute);
        })
        .catch((err) => {
          console.error(`[HEARTBEAT] Tick failed: ${err.message}`);
          if (running) scheduleNextTick(false);
        });
    }, nextTickMs);
  }

  // ─── Public API ──────────────────────────────────────────────

  const start = (): void => {
    if (running) return;
    running = true;

    // Run first tick immediately
    tick()
      .then((isLowCompute) => {
        if (!running) return;
        scheduleNextTick(isLowCompute);
      })
      .catch((err) => {
        console.error(`[HEARTBEAT] Tick failed: ${err.message}`);
        if (running) scheduleNextTick(false);
      });

    console.log(
      `[HEARTBEAT] Daemon started. Tick interval: ${baseTickMs / 1000}s (low-compute multiplier: ${lowComputeMultiplier}x)`,
    );
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    if (intervalId) {
      clearTimeout(intervalId);
      intervalId = null;
    }
    console.log("[HEARTBEAT] Daemon stopped.");
  };

  const isRunning = (): boolean => running;

  const forceRun = async (taskName: string): Promise<void> => {
    const entries = db.getHeartbeatEntries();
    const entry = entries.find((e) => e.name === taskName);
    if (entry) {
      await executeTask(entry);
    }
  };

  return { start, stop, isRunning, forceRun };
}
