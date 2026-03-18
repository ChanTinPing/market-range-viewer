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
  const dates = resolveDateWindow(input.interval, input.range, input.start, input.end);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(input.symbol)}`);

  url.searchParams.set("interval", input.interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits,capitalGains");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");

  if (dates.start && dates.end) {
    url.searchParams.set("period1", String(Math.floor(new Date(`${dates.start}T00:00:00Z`).getTime() / 1000)));
    url.searchParams.set("period2", String(Math.floor(new Date(`${dates.end}T23:59:59Z`).getTime() / 1000)));
  } else {
    url.searchParams.set("range", input.range);
  }

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

  return {
    symbol: input.symbol,
    interval: input.interval,
    range: input.range,
    start: input.start,
    end: input.end,
    effectiveStart: dates.start,
    effectiveEnd: dates.end,
    note: dates.note,
    snapshot: toSnapshot(result.meta, result.indicators?.quote?.[0]),
    points: toCandles(result),
  };
}

export function defaultDateRange(range: RangePreset) {
  if (range === "max") {
    return { start: "", end: "" };
  }

  const days = PRESET_TO_DAYS[range];
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

function resolveDateWindow(interval: ChartInterval, range: RangePreset, start: string | null, end: string | null) {
  if (!start || !end) {
    return {
      start: null,
      end: null,
      note: interval === "5m" ? "分时图默认取最近可用窗口，你也可以继续拖拽缩放。" : null,
    };
  }

  if (start > end) {
    return {
      start: end,
      end: start,
      note: "开始日期晚于结束日期，已自动交换。",
    };
  }

  if (interval !== "5m") {
    return { start, end, note: null };
  }

  const spanDays = Math.ceil((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000);

  if (spanDays <= 60) {
    return { start, end, note: null };
  }

  const clampedStartDate = new Date(`${end}T00:00:00Z`);
  clampedStartDate.setUTCDate(clampedStartDate.getUTCDate() - 59);

  return {
    start: clampedStartDate.toISOString().slice(0, 10),
    end,
    note: "免费分时数据通常只有最近约 60 天，已自动缩到可用范围。",
  };
}

function toSnapshot(meta?: YahooChartMeta, quote?: YahooChartQuote): AssetSnapshot {
  const closes = quote?.close?.filter((value): value is number => typeof value === "number") ?? [];
  const latestClose = closes.at(-1) ?? null;
  const previousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
  const change = latestClose !== null && previousClose !== null ? latestClose - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;

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
    dayHigh: maxNumber(quote?.high),
    dayLow: minNumber(quote?.low),
    open: firstNumber(quote?.open),
    volume: lastNumber(quote?.volume),
    fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta?.fiftyTwoWeekLow ?? null,
    regularMarketTime: meta?.regularMarketTime ?? null,
  };
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

function firstNumber(values?: Array<number | null>) {
  return values?.find((value): value is number => typeof value === "number") ?? null;
}

function lastNumber(values?: Array<number | null>) {
  const found = [...(values ?? [])].reverse().find((value): value is number => typeof value === "number");
  return found ?? null;
}

function maxNumber(values?: Array<number | null>) {
  const valid = (values ?? []).filter((value): value is number => typeof value === "number");
  return valid.length > 0 ? Math.max(...valid) : null;
}

function minNumber(values?: Array<number | null>) {
  const valid = (values ?? []).filter((value): value is number => typeof value === "number");
  return valid.length > 0 ? Math.min(...valid) : null;
}
