import { NextRequest, NextResponse } from "next/server";
import { getChartQuery } from "@/lib/market";
import { getChartData } from "@/lib/market-data-source";

export async function GET(request: NextRequest) {
  try {
    const query = getChartQuery(request);
    const payload = await getChartData(query);

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Chart request failed",
      },
      { status: 500 },
    );
  }
}
