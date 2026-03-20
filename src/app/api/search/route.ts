import { NextRequest, NextResponse } from "next/server";
import { getRequestDataSource, getSearchQuery } from "@/lib/market";
import { searchSymbols } from "@/lib/market-data-source";

export async function GET(request: NextRequest) {
  try {
    const query = getSearchQuery(request);
    const source = getRequestDataSource(request);

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchSymbols(query, source);
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
