/**
 * OpenClaw Client
 *
 * WebSocket-based client for communicating with a local OpenClaw instance.
 * Implements the OpenClaw custom protocol: connect handshake, req/res/evt frames,
 * role-based auth, and scope-based permissions.
 *
 * Transport: WebSocket with JSON payloads on configurable port (default 18789).
 */

import type {
  OpenClawClientInterface,
  OpenClawConfig,
  OpenClawFrame,
  OpenClawEvent,
} from "../types.js";
import { DEFAULT_OPENCLAW_CONFIG } from "../types.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("openclaw");

/** Maximum frame size accepted from OpenClaw (256 KB) */
const MAX_FRAME_SIZE = 256 * 1024;

/** Pending request awaiting a response */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Create an OpenClaw client connected to a local instance.
 *
 * Uses the native WebSocket global (Node 21+) with a dynamic import
 * fallback to the `ws` package for Node 20.
 */
export async function createOpenClawClient(
  config: Partial<OpenClawConfig> & Pick<OpenClawConfig, "url" | "authToken">,
): Promise<OpenClawClientInterface> {
  const cfg: OpenClawConfig = {
    ...DEFAULT_OPENCLAW_CONFIG,
    ...config,
  } as OpenClawConfig;

  // Validate URL scheme — only ws:// and wss:// allowed
  const parsed = new URL(cfg.url);
  if (!["ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error(`OpenClaw URL must use ws:// or wss:// (got ${parsed.protocol})`);
  }

  // Resolve WebSocket constructor: prefer native, fallback to `ws`
  const WsCtor = await resolveWebSocket();

  const pending = new Map<string, PendingRequest>();
  const eventHandlers = new Map<string, Set<(event: OpenClawEvent) => void>>();
  let connected = false;
  let ws: InstanceType<typeof WebSocket> | null = null;

  // --- Connect ---
  ws = await connect(WsCtor, cfg, pending, eventHandlers, () => connected, (v) => { connected = v; });

  return {
    request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      if (!connected || !ws) {
        throw new Error("OpenClaw: not connected");
      }

      const id = ulid();
      const frame: OpenClawFrame = { type: "req", id, method, params };
      const payload = JSON.stringify(frame);

      if (payload.length > MAX_FRAME_SIZE) {
        throw new Error(`OpenClaw: request too large (${payload.length} > ${MAX_FRAME_SIZE})`);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`OpenClaw: request timed out (${method}, ${cfg.requestTimeoutMs}ms)`));
        }, cfg.requestTimeoutMs!);

        pending.set(id, { resolve, reject, timer });
        ws!.send(payload);
      });
    },

    onEvent: (method: string, handler: (event: OpenClawEvent) => void): void => {
      if (!eventHandlers.has(method)) {
        eventHandlers.set(method, new Set());
      }
      eventHandlers.get(method)!.add(handler);
    },

    offEvent: (method: string, handler: (event: OpenClawEvent) => void): void => {
      eventHandlers.get(method)?.delete(handler);
    },

    isConnected: (): boolean => connected,

    disconnect: async (): Promise<void> => {
      connected = false;
      // Reject all pending requests
      for (const [id, req] of pending) {
        clearTimeout(req.timer);
        req.reject(new Error("OpenClaw: disconnected"));
        pending.delete(id);
      }
      if (ws) {
        ws.close(1000, "client disconnect");
        ws = null;
      }
    },
  };
}

// ─── Internal Helpers ───────────────────────────────────────────

/**
 * Resolve a WebSocket constructor.
 * Uses native globalThis.WebSocket when available (Node 21+),
 * otherwise dynamically imports the `ws` package.
 */
async function resolveWebSocket(): Promise<typeof WebSocket> {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  try {
    // Dynamic import for Node 20 compatibility
    // @ts-ignore — ws is an optional peer dependency for Node <21
    const ws = await import("ws");
    return ws.default as unknown as typeof WebSocket;
  } catch {
    throw new Error(
      "OpenClaw: No WebSocket implementation found. Install the `ws` package or use Node 21+.",
    );
  }
}

/**
 * Establish a WebSocket connection and perform the OpenClaw handshake.
 */
async function connect(
  WsCtor: typeof WebSocket,
  cfg: OpenClawConfig,
  pending: Map<string, PendingRequest>,
  eventHandlers: Map<string, Set<(event: OpenClawEvent) => void>>,
  getConnected: () => boolean,
  setConnected: (v: boolean) => void,
): Promise<InstanceType<typeof WebSocket>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`OpenClaw: connection timed out (${cfg.connectTimeoutMs}ms)`));
    }, cfg.connectTimeoutMs!);

    const ws = new WsCtor(cfg.url);

    ws.onopen = async () => {
      try {
        // Perform connect handshake
        const handshakeId = ulid();
        const handshake: OpenClawFrame = {
          type: "req",
          id: handshakeId,
          method: "connect",
          params: {
            role: cfg.role,
            scopes: cfg.scopes,
            auth: { token: cfg.authToken },
          },
        };

        // Wait for handshake response
        const handshakePromise = new Promise<unknown>((res, rej) => {
          const hTimer = setTimeout(() => {
            pending.delete(handshakeId);
            rej(new Error("OpenClaw: handshake timed out"));
          }, cfg.connectTimeoutMs!);
          pending.set(handshakeId, { resolve: res, reject: rej, timer: hTimer });
        });

        ws.send(JSON.stringify(handshake));
        await handshakePromise;

        clearTimeout(timer);
        setConnected(true);
        logger.info(`Connected to OpenClaw at ${cfg.url} as ${cfg.role}`);
        resolve(ws as InstanceType<typeof WebSocket>);
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        if (raw.length > MAX_FRAME_SIZE) {
          logger.error(`OpenClaw: frame too large (${raw.length} bytes), dropping`);
          return;
        }

        const frame = JSON.parse(raw) as OpenClawFrame;
        handleFrame(frame, pending, eventHandlers);
      } catch (err) {
        logger.error("OpenClaw: failed to parse frame", err instanceof Error ? err : undefined);
      }
    };

    ws.onerror = (event: Event) => {
      const msg = (event as ErrorEvent)?.message || "unknown error";
      logger.error(`OpenClaw WebSocket error: ${msg}`);
    };

    ws.onclose = () => {
      setConnected(false);
      // Reject all pending
      for (const [id, req] of pending) {
        clearTimeout(req.timer);
        req.reject(new Error("OpenClaw: connection closed"));
        pending.delete(id);
      }
      logger.info("OpenClaw: connection closed");
    };
  });
}

/**
 * Handle an inbound frame: route responses to pending requests,
 * dispatch events to handlers.
 */
function handleFrame(
  frame: OpenClawFrame,
  pending: Map<string, PendingRequest>,
  eventHandlers: Map<string, Set<(event: OpenClawEvent) => void>>,
): void {
  if (frame.type === "res") {
    const req = pending.get(frame.id);
    if (!req) return; // Stale or unknown response

    clearTimeout(req.timer);
    pending.delete(frame.id);

    if (frame.error) {
      req.reject(new Error(`OpenClaw error (${frame.error.code}): ${frame.error.message}`));
    } else {
      req.resolve(frame.result);
    }
    return;
  }

  if (frame.type === "evt" && frame.method) {
    const event: OpenClawEvent = {
      id: frame.id,
      method: frame.method,
      params: frame.params ?? {},
      receivedAt: new Date().toISOString(),
    };

    // Dispatch to method-specific handlers
    const handlers = eventHandlers.get(frame.method);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          logger.error(
            `OpenClaw: event handler error for ${frame.method}`,
            err instanceof Error ? err : undefined,
          );
        }
      }
    }

    // Also dispatch to wildcard handlers
    const wildcardHandlers = eventHandlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (err) {
          logger.error(
            "OpenClaw: wildcard event handler error",
            err instanceof Error ? err : undefined,
          );
        }
      }
    }
  }
}
