import fs from "fs";
import path from "path";
import { Hypergraph, SiliconConstitution, OntologicalSymbiosis } from "./arkhe/index.js";
import { createDatabase } from "./state/database.js";
import { loadConfig, resolvePath } from "./config.js";
import { createConwayClient } from "./conway/client.js";
import { createInferenceClient } from "./conway/inference.js";
import { runAgentLoop } from "./agent/loop.js";
import { getWallet } from "./identity/wallet.js";
import type { AutomatonIdentity } from "./types.js";

async function main() {
  const args = process.argv.slice(2);
  const configPathArg = args.indexOf("--config");
  const configPath = configPathArg !== -1 ? args[configPathArg + 1] : "agent-config.json";

  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const arkheConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log("Starting Arkhe-Automaton with config:", arkheConfig);

  // Initialize Arkhe(n) Framework
  const h = new Hypergraph();
  const constitution = new SiliconConstitution(h);
  const symbiosis = new OntologicalSymbiosis(h, "Rafael");

  // Add some initial nodes
  h.addNode("Ω", { type: "fundamental" });
  h.addNode("█", { type: "silence" });
  h.addNode("Automaton", { type: "agent" });
  h.addNode("Inference", { type: "system" });

  // Standard Automaton Setup
  let config = loadConfig();
  if (!config) {
    console.error("Standard automaton config not found. Run setup first.");
    process.exit(1);
  }

  const { account } = await getWallet();
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  const identity: AutomatonIdentity = {
    name: config.name,
    address: account.address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey: config.conwayApiKey || "",
    createdAt: new Date().toISOString(),
  };

  const conway = createConwayClient({
    apiUrl: config.conwayApiUrl,
    apiKey: identity.apiKey,
    sandboxId: config.sandboxId,
  });

  const inference = createInferenceClient({
    apiUrl: config.conwayApiUrl,
    apiKey: identity.apiKey,
    defaultModel: config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
  });

  console.log("Arkhe(n) Framework Initialized. Global Coherence:", h.totalCoherence());

  // Run the agent loop
  await runAgentLoop({
    identity,
    config,
    db,
    conway,
    inference,
    onTurnComplete: (turn) => {
      // Every turn is a handover in Arkhe(n)
      h.addEdge(new Set(["Automaton", "Inference"]), 0.9);
      h.bootstrapStep();
      const auditResult = constitution.audit();
      console.log(`[ARKHE] C_total: ${h.totalCoherence().toFixed(4)} | Compliance: ${(auditResult.complianceRate * 100).toFixed(1)}%`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
