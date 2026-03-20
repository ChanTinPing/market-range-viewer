import type { ChartDataRequest, ChartPayload, MarketDataSource, SearchResult } from "@/lib/market-types";
import { searchMockSymbols, getMockChartData } from "@/lib/market-mock";
import { searchYahooSymbols, getYahooChartData } from "@/lib/market-yahoo";

export async function searchSymbols(query: string, source: MarketDataSource): Promise<SearchResult[]> {
  if (source === "mock") {
    return searchMockSymbols(query);
  }

  return searchYahooSymbols(query);
}

export async function getChartData(input: ChartDataRequest): Promise<ChartPayload> {
  if (input.source === "mock") {
    return getMockChartData(input);
  }

  return getYahooChartData(input);
}
