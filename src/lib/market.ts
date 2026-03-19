import type { NextRequest } from "next/server";
import type { AssetSnapshot, CandlePoint, ChartInterval, RangePreset, SearchResult } from "@/lib/market-types";

type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
  market?: string;
};

type YahooChartMeta = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  exchangeName?: string;
  gmtoffset?: number;
  instrumentType?: string;
  marketState?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
};

type YahooChartQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartResult = {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: YahooChartQuote[];
  };
};

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 MarketRangeViewer/1.0",
  Accept: "application/json",
};

const PRESET_TO_DAYS: Record<Exclude<RangePreset, "max">, number> = {
  "1mo": 31,
  "3mo": 93,
  "6mo": 186,
  "1y": 366,
  "3y": 366 * 3,
  "5y": 366 * 5,
};

const FETCH_RANGE_BY_INTERVAL: Record<ChartInterval, string> = {
  "5m": "60d",
  "1d": "max",
  "1wk": "max",
  "1mo": "max",
};

export const DEFAULT_SYMBOL = "AAPL";
export const DEFAULT_RANGE: RangePreset = "1y";
export const DEFAULT_INTERVAL: ChartInterval = "1d";

export function getSearchQuery(request: NextRequest) {
  return request.nextUrl.searchParams.get("q")?.trim() ?? "";
}

export function getChartQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  return {
    symbol: normalizeSymbol(params.get("symbol")),
    interval: validateInterval(params.get("interval")),
    range: validateRange(params.get("range")),
    start: normalizeDateInput(params.get("start")),
    end: normalizeDateInput(params.get("end")),
  };
}

export function normalizeSymbol(symbol: string | null) {
  return (symbol ?? DEFAULT_SYMBOL).trim().toUpperCase();
}

export function rangePresetDays(range: Exclude<RangePreset, "max">) {
  return PRESET_TO_DAYS[range];
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  if (!query) {
    return [];
  }

  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "8");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");

  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    next: { revalidate: 900 },
  });

  if (!response.ok) {
    throw new Error(`Search request failed with ${response.status}`);
  }

  const payload = (await response.json()) as { quotes?: YahooSearchQuote[] };

  return (payload.quotes ?? [])
    .filter((quote) => quote.symbol)
    .map((quote) => ({
      symbol: quote.symbol ?? "",
      shortName: quote.shortname ?? quote.longname ?? quote.symbol ?? "",
      longName: quote.longname ?? quote.shortname ?? quote.symbol ?? "",
      exchange: quote.exchDisp ?? quote.exchange ?? "",
      market: quote.market ?? "",
      type: quote.quoteType ?? "",
    }));
}

export async function getChartData(input: {
  symbol: string;
  interval: ChartInterval;
  range: RangePreset;
  start: string | null;
  end: string | null;
}) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(input.symbol)}`);

  url.searchParams.set("interval", input.interval);
  url.searchParams.set("range", FETCH_RANGE_BY_INTERVAL[input.interval]);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits,capitalGains");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");

  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Chart request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: YahooChartResult[];
      error?: { description?: string | null };
    };
  };

  if (payload.chart?.error) {
    throw new Error(payload.chart.error.description ?? "Unknown chart error");
  }

  const result = payload.chart?.result?.[0];

  if (!result) {
    throw new Error("No chart data returned");
  }

  const points = toCandles(result);

  return {
    symbol: input.symbol,
    interval: input.interval,
    range: input.range,
    start: input.start,
    end: input.end,
    effectiveStart: points[0]?.time ?? null,
    effectiveEnd: points.at(-1)?.time ?? null,
    note: input.interval === "5m" ? "5 分钟数据通常只提供最近约 60 天，缩放时会使用完整可用窗口。" : null,
    snapshot: toSnapshot(result.meta, points, input.interval),
    points,
  };
}

export function defaultDateRange(range: RangePreset) {
  if (range === "max") {
    return { start: "", end: "" };
  }

  const days = rangePresetDays(range);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function validateInterval(value: string | null): ChartInterval {
  const allowed: ChartInterval[] = ["5m", "1d", "1wk", "1mo"];
  return allowed.includes(value as ChartInterval) ? (value as ChartInterval) : DEFAULT_INTERVAL;
}

function validateRange(value: string | null): RangePreset {
  const allowed: RangePreset[] = ["1mo", "3mo", "6mo", "1y", "3y", "5y", "max"];
  return allowed.includes(value as RangePreset) ? (value as RangePreset) : DEFAULT_RANGE;
}

function normalizeDateInput(value: string | null) {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function toSnapshot(meta: YahooChartMeta | undefined, points: CandlePoint[], interval: ChartInterval): AssetSnapshot {
  const latestPoint = points.at(-1) ?? null;
  const latestClose = latestPoint?.close ?? null;
  const previousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
  const change = latestClose !== null && previousClose !== null ? latestClose - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const latestSession = getLatestSessionPoints(points, interval, meta?.gmtoffset ?? 0);

  return {
    symbol: meta?.symbol ?? "",
    shortName: meta?.shortName ?? meta?.symbol ?? "",
    longName: meta?.longName ?? meta?.shortName ?? meta?.symbol ?? "",
    currency: meta?.currency ?? "",
    exchange: meta?.exchangeName ?? "",
    quoteType: meta?.instrumentType ?? "",
    marketState: meta?.marketState ?? "",
    regularMarketPrice: meta?.regularMarketPrice ?? latestClose,
    previousClose,
    change,
    changePercent,
    dayHigh: maxValue(latestSession, "high"),
    dayLow: minValue(latestSession, "low"),
    open: latestSession[0]?.open ?? null,
    volume: latestSession.length > 0 ? latestSession.reduce((sum, point) => sum + point.volume, 0) : null,
    fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta?.fiftyTwoWeekLow ?? null,
    regularMarketTime: meta?.regularMarketTime ?? null,
  };
}

function getLatestSessionPoints(points: CandlePoint[], interval: ChartInterval, offsetSeconds: number) {
  if (points.length === 0) {
    return [];
  }

  if (interval !== "5m") {
    return [points.at(-1) as CandlePoint];
  }

  const latestSessionKey = toSessionKey(points.at(-1) as CandlePoint, offsetSeconds);
  return points.filter((point) => toSessionKey(point, offsetSeconds) === latestSessionKey);
}

function toSessionKey(point: CandlePoint, offsetSeconds: number) {
  return new Date(new Date(point.time).getTime() + offsetSeconds * 1000).toISOString().slice(0, 10);
}

function toCandles(result: YahooChartResult): CandlePoint[] {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];

  if (!quote) {
    return [];
  }

  return timestamps.flatMap((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];

    if ([open, high, low, close].some((value) => typeof value !== "number")) {
      return [];
    }

    return [
      {
        time: new Date(timestamp * 1000).toISOString(),
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: typeof volume === "number" ? volume : 0,
      },
    ];
  });
}

function maxValue(points: CandlePoint[], field: "high" | "open" | "close") {
  if (points.length === 0) {
    return null;
  }

  return Math.max(...points.map((point) => point[field]));
}

function minValue(points: CandlePoint[], field: "low" | "open" | "close") {
  if (points.length === 0) {
    return null;
  }

  return Math.min(...points.map((point) => point[field]));
}
