import { NextRequest, NextResponse } from "next/server";
import { askLogs, clamp, extractFilter, readJsonBody, toNumber } from "@/lib/server/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const filter = extractFilter(request.nextUrl.searchParams, body);
    const limit = clamp(toNumber(body.limit) ?? 120, 10, 300);

    const result = await askLogs({
      filter,
      question,
      limit,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    const status = message.includes("No Conway API key") ? 400 : 502;
    return NextResponse.json(
      {
        error: message,
      },
      { status },
    );
  }
}
