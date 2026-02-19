import { NextRequest, NextResponse } from "next/server";
import {
  decodeCursor,
  encodeCursor,
  extractFilter,
  queryTurnsPage,
  serializeTurn,
} from "@/lib/server/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const filter = extractFilter(request.nextUrl.searchParams);
    const cursorParam = request.nextUrl.searchParams.get("cursor");
    const cursor = decodeCursor(cursorParam);
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const page = queryTurnsPage(filter, cursor);
    const nextCursor =
      page.hasMore && page.turns.length > 0
        ? encodeCursor({
            timestamp: page.turns[page.turns.length - 1].timestamp,
            id: page.turns[page.turns.length - 1].id,
          })
        : null;
    const headCursor =
      page.turns.length > 0
        ? encodeCursor({
            timestamp: page.turns[0].timestamp,
            id: page.turns[0].id,
          })
        : null;

    return NextResponse.json(
      {
        total: page.totalMatched,
        returned: page.turns.length,
        limit: filter.limit,
        nextCursor,
        headCursor,
        logs: page.turns.map((turn) => serializeTurn(turn)),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to load logs",
        details: err instanceof Error ? err.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
