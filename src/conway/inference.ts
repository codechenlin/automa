/**
 * Inference Client — Anthropic Direct
 *
 * Calls Anthropic's messages API using the OAuth token (sk-ant-oat01-...).
 * Auth mechanism: Authorization: Bearer <token>  (same as Pi/Claude Code CLI)
 * NOT x-api-key — that header is for regular Anthropic API keys only.
 *
 * Implements the same InferenceClient interface so nothing else changes.
 */

import type {
  InferenceClient,
  ChatMessage,
  InferenceOptions,
  InferenceResponse,
  InferenceToolCall,
} from "../types.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8096;

interface InferenceClientOptions {
  apiUrl: string;       // unused — kept for interface compat
  apiKey: string;       // unused — kept for interface compat
  defaultModel: string; // unused — kept for interface compat
  maxTokens: number;
  lowComputeModel?: string;
}

// ─── Core inference function ───────────────────────────────────────────────
//
// Signature: callAnthropic(system, messages, tools) → { text, toolCalls, inputTokens, outputTokens }

interface AnthropicResult {
  text: string;
  toolCalls: InferenceToolCall[];
  inputTokens: number;
  outputTokens: number;
}

async function callAnthropic(
  system: string,
  messages: ChatMessage[],
  tools: unknown[],
  maxTokens: number,
): Promise<AnthropicResult> {
  const token = process.env.ANTHROPIC_API_KEY;
  if (!token) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Run run-local.sh or: export ANTHROPIC_API_KEY=$(python3 -c \"import json; d=json.load(open('/Users/stackie/.openclaw/agents/main/agent/auth-profiles.json')); print(d['profiles']['anthropic:default']['token'])\")",
    );
  }

  const body: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    messages: messages.map(formatMessage),
  };

  if (system) body.system = system;
  if (tools.length > 0) body.tools = tools.map(convertToAnthropicTool);

  // Exact headers Pi uses for OAuth tokens — source:
  // @mariozechner/pi-ai/dist/providers/anthropic.js, createClient(), isOAuthToken branch.
  // The anthropic-beta header with oauth-2025-04-20 is REQUIRED for sk-ant-oat01 tokens.
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "authorization": `Bearer ${token}`,
      "user-agent": "claude-cli/2.1.2 (external, cli)",
      "x-app": "cli",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic inference error: ${resp.status}: ${text}`);
  }

  const data = await resp.json() as {
    id: string;
    model: string;
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const toolUseBlocks = data.content.filter((c) => c.type === "tool_use");

  const toolCalls: InferenceToolCall[] = toolUseBlocks.map((tc) => ({
    id: tc.id ?? "",
    type: "function" as const,
    function: {
      name: tc.name ?? "",
      arguments: JSON.stringify(tc.input ?? {}),
    },
  }));

  return {
    text,
    toolCalls,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  };
}

// ─── InferenceClient wrapper (keeps existing interface intact) ─────────────

export function createInferenceClient(
  options: InferenceClientOptions,
): InferenceClient {
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;

  const chat = async (
    messages: ChatMessage[],
    opts?: InferenceOptions,
  ): Promise<InferenceResponse> => {
    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");
    const system = systemMessages.map((m) => m.content).join("\n\n");

    const result = await callAnthropic(
      system,
      otherMessages,
      opts?.tools ?? [],
      opts?.maxTokens ?? maxTokens,
    );

    const toolCalls: InferenceToolCall[] | undefined =
      result.toolCalls.length > 0 ? result.toolCalls : undefined;

    return {
      id: "",
      model: ANTHROPIC_MODEL,
      message: {
        role: "assistant",
        content: result.text,
        tool_calls: toolCalls,
      },
      toolCalls,
      usage: {
        promptTokens: result.inputTokens,
        completionTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
      },
      finishReason: toolCalls ? "tool_calls" : "stop",
    };
  };

  const setLowComputeMode = (_enabled: boolean): void => {};
  const getDefaultModel = (): string => ANTHROPIC_MODEL;

  return { chat, setLowComputeMode, getDefaultModel };
}

// ─── Message formatters ────────────────────────────────────────────────────

function formatMessage(msg: ChatMessage): Record<string, unknown> {
  // Tool results: role "tool" → Anthropic user/tool_result block
  if (msg.role === "tool") {
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        // Anthropic rejects empty tool_result content with a 400 — guard against it
        content: msg.content || "(empty result)",
      }],
    };
  }

  // Assistant with tool calls → mixed content array
  if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
    const content: Array<Record<string, unknown>> = [];
    if (msg.content) content.push({ type: "text", text: msg.content });
    for (const tc of msg.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: (() => {
          try { return JSON.parse(tc.function.arguments ?? "{}"); }
          catch { return {}; }
        })(),
      });
    }
    return { role: "assistant", content };
  }

  return { role: msg.role, content: msg.content };
}

function convertToAnthropicTool(tool: unknown): Record<string, unknown> {
  const t = tool as Record<string, unknown>;
  // OpenAI format: { type: "function", function: { name, description, parameters } }
  if (t["function"]) {
    const f = t["function"] as Record<string, unknown>;
    return {
      name: f["name"] ?? "",
      description: f["description"] ?? "",
      input_schema: f["parameters"] ?? { type: "object", properties: {} },
    };
  }
  // Bare format: { name, description, parameters | input_schema }
  return {
    name: t["name"] ?? "",
    description: t["description"] ?? "",
    input_schema: t["parameters"] ?? t["input_schema"] ?? { type: "object", properties: {} },
  };
}
