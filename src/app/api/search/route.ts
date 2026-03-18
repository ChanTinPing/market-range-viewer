import { NextRequest, NextResponse } from "next/server";
import { getSearchQuery, searchSymbols } from "@/lib/market";

export async function GET(request: NextRequest) {
  try {
    const query = getSearchQuery(request);

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchSymbols(query);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Search failed",
        results: [],
      },
      { status: 500 },
    );
  }
}
