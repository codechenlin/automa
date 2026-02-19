import { NextRequest } from "next/server";
import {
  collectTurnsAfterCursor,
  decodeCursor,
  encodeCursor,
  extractFilter,
  queryTurnsPage,
  serializeTurn,
} from "@/lib/server/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEvent(event: string, payload: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  const filter = extractFilter(request.nextUrl.searchParams);
  const cursorParam = request.nextUrl.searchParams.get("cursor");
  const decodedCursor = decodeCursor(cursorParam);

  if (cursorParam && !decodedCursor) {
    return new Response(JSON.stringify({ error: "Invalid cursor" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let streamCursor: { timestamp: string; id: string };
      let pollTimer: ReturnType<typeof setInterval> | undefined;
      let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

      if (decodedCursor) {
        streamCursor = decodedCursor;
      } else {
        const latestPage = queryTurnsPage({
          from: filter.from,
          to: filter.to,
          q: filter.q,
          state: filter.state,
          limit: 1,
        });
        const latest = latestPage.turns[0];
        streamCursor = latest
          ? {
              timestamp: latest.timestamp,
              id: latest.id,
            }
          : {
              timestamp: new Date().toISOString(),
              id: "",
            };
      }

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      send(": stream-open\n\n");
      send(
        sseEvent("ready", {
          cursor: encodeCursor(streamCursor),
          pollMs: 2000,
        }),
      );

      pollTimer = setInterval(() => {
        if (closed) return;
        const fresh = collectTurnsAfterCursor(filter, streamCursor, 800, 120);
        if (fresh.length === 0) return;

        streamCursor = {
          timestamp: fresh[0].timestamp,
          id: fresh[0].id,
        };

        send(
          sseEvent("logs", {
            cursor: encodeCursor(streamCursor),
            count: fresh.length,
            logs: fresh.map((turn) => serializeTurn(turn)),
          }),
        );
      }, 2000);

      keepAliveTimer = setInterval(() => {
        send(": keep-alive\n\n");
      }, 15000);

      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
