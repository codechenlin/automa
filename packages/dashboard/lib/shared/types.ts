export const AGENT_STATES = [
  "setup",
  "waking",
  "running",
  "sleeping",
  "low_compute",
  "critical",
  "dead",
] as const;

export type AgentStateName = (typeof AGENT_STATES)[number];

export interface Cursor {
  timestamp: string;
  id: string;
}

export interface SerializedToolCall {
  id?: string;
  name: string;
  durationMs?: number;
  error: string | null;
  result: string;
}

export interface SerializedTurn {
  id: string;
  timestamp: string;
  state: AgentStateName;
  inputSource: string | null;
  input: string;
  thinking: string;
  summary: string;
  toolNames: string[];
  hasError: boolean;
  tokenUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costCents: number;
  tools: SerializedToolCall[];
}

export interface LogsResponse {
  total: number;
  returned: number;
  limit: number;
  nextCursor: string | null;
  headCursor: string | null;
  logs: SerializedTurn[];
}

export interface AskResponse {
  answer: string;
  modelUsed: string | null;
  sources: Array<{
    id: string;
    timestamp: string;
    state: AgentStateName;
    snippet: string;
  }>;
}

export interface OverviewResponse {
  runtime: {
    state: AgentStateName;
    tier: "normal" | "low_compute" | "critical" | "dead";
    turnCount: number;
    lastTurnAt: string | null;
    lastHeartbeatAt: string | null;
    activeHeartbeats: number;
  };
  model: {
    configured: string;
    active: string;
    lastUsed: string;
    lastUsedAt: string | null;
  };
  balances: {
    creditsCents: number;
    creditsUsd: number;
    usdc: number | null;
    source: "live" | "cached";
  };
  creator: string;
  distress: boolean;
}
