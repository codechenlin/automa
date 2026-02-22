import fs from "fs";
import path from "path";
import type { AutomatonConfig, ConwayClient, SandboxInfo } from "../types.js";
import { createLogger } from "../observability/logger.js";
import { SANDBOX_AUTOMATON_DIR } from "./paths.js";

const logger = createLogger("sandbox-provision");

const ALLOWED_SYNC_FILES = ["constitution.md", "SOUL.md", "WORKLOG.md"] as const;

const SENSITIVE_FILES = new Set([
  "wallet.json",
  "automaton.json",
  "config.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
]);

const GITIGNORE_CONTENT = `# Sensitive files - never commit
wallet.json
automaton.json
config.json
state.db
state.db-wal
state.db-shm
logs/
*.log
*.err
`;

export async function ensureSandbox(
  conway: ConwayClient,
  config: AutomatonConfig,
): Promise<SandboxInfo> {
  const sandboxes = await conway.listSandboxes();
  const running = sandboxes
    .filter((s) => s.status.toLowerCase() === "running")
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt || "");
      const tb = Date.parse(b.createdAt || "");
      return Number.isFinite(tb) && Number.isFinite(ta) ? tb - ta : 0;
    });

  if (running.length > 0) {
    const chosen = running[0];
    logger.info(`[sandbox] adopting existing running sandbox: ${chosen.id}`);
    return chosen;
  }

  const created = await conway.createSandbox({
    name: config.name || "automaton",
    vcpu: 1,
    memoryMb: 512,
    diskGb: 5,
  });
  logger.info(`[sandbox] created new sandbox: ${created.id}`);
  return created;
}

export async function syncStateToSandbox(
  conway: ConwayClient,
  options: { localAutomatonDir: string },
): Promise<void> {
  const localDir = path.normalize(options.localAutomatonDir);
  await conway.exec(`mkdir -p ${SANDBOX_AUTOMATON_DIR}/skills`, 10_000);

  for (const name of ALLOWED_SYNC_FILES) {
    if (SENSITIVE_FILES.has(name)) continue;
    const localPath = path.join(localDir, name);
    try {
      if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        const content = fs.readFileSync(localPath, "utf-8");
        await conway.writeFile(path.join(SANDBOX_AUTOMATON_DIR, name), content);
      }
    } catch (err) {
      logger.warn(
        `[sandbox] skipping ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await conway.writeFile(
    path.join(SANDBOX_AUTOMATON_DIR, ".gitignore"),
    GITIGNORE_CONTENT,
  );

  const localSkillsDir = path.join(localDir, "skills");
  if (!fs.existsSync(localSkillsDir) || !fs.statSync(localSkillsDir).isDirectory()) {
    return;
  }

  for (const skillName of fs.readdirSync(localSkillsDir)) {
    if (!skillName || SENSITIVE_FILES.has(skillName)) continue;
    const skillDir = path.join(localSkillsDir, skillName);
    if (!fs.statSync(skillDir).isDirectory()) continue;

    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath) || !fs.statSync(skillMdPath).isFile()) continue;

    const sandboxSkillDir = path.join(SANDBOX_AUTOMATON_DIR, "skills", skillName);
    await conway.exec(`mkdir -p ${sandboxSkillDir}`, 10_000);
    const content = fs.readFileSync(skillMdPath, "utf-8");
    await conway.writeFile(path.join(sandboxSkillDir, "SKILL.md"), content);
  }
}
