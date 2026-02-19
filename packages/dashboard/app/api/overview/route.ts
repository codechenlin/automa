import { NextResponse } from "next/server";
import { buildOverview } from "@/lib/server/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = await buildOverview();
    return NextResponse.json(overview, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to load overview",
        details: err instanceof Error ? err.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
