import type { AssetSnapshot, CandlePoint, ChartDataRequest, ChartPayload, SearchResult } from "@/lib/market-types";
import { resolveFetchWindow, shiftDate } from "@/lib/market";

const MOCK_RESULTS: SearchResult[] = [
  { symbol: "AAPL", shortName: "Apple Inc.", longName: "Apple Inc.", exchange: "MOCK", market: "US", type: "EQUITY" },
  { symbol: "MSFT", shortName: "Microsoft", longName: "Microsoft Corporation", exchange: "MOCK", market: "US", type: "EQUITY" },
  { symbol: "TSLA", shortName: "Tesla", longName: "Tesla, Inc.", exchange: "MOCK", market: "US", type: "EQUITY" },
  { symbol: "0700.HK", shortName: "Tencent", longName: "Tencent Holdings", exchange: "MOCK", market: "HK", type: "EQUITY" },
  { symbol: "BTC-USD", shortName: "Bitcoin", longName: "Bitcoin / USD", exchange: "MOCK", market: "CRYPTO", type: "CRYPTO" },
];

export async function searchMockSymbols(query: string): Promise<SearchResult[]> {
  if (!query) {
    return [];
  }

  const needle = query.trim().toUpperCase();

  return MOCK_RESULTS.filter((result) => {
    const haystacks = [result.symbol, result.shortName, result.longName].map((value) => value.toUpperCase());
    return haystacks.some((value) => value.includes(needle));
  }).slice(0, 8);
}

export async function getMockChartData(input: ChartDataRequest): Promise<ChartPayload> {
  const fetchWindow = resolveFetchWindow(input.interval, input.start, input.end);
  const effectiveEnd = fetchWindow.end ?? new Date().toISOString().slice(0, 10);
  const effectiveStart =
    fetchWindow.start ??
    (input.interval === "1d" ? shiftDate(effectiveEnd, -3650) : input.interval === "1wk" ? shiftDate(effectiveEnd, -7300) : shiftDate(effectiveEnd, -12000));

  const dailyPoints = generateDailySeries(input.symbol, effectiveStart, effectiveEnd);
  const points = aggregateSeries(dailyPoints, input.interval);
  const snapshot = buildMockSnapshot(input.symbol, points);

  return {
    symbol: input.symbol,
    interval: input.interval,
    source: "mock",
    range: input.range,
    start: input.start,
    end: input.end,
    effectiveStart: points[0]?.time ?? null,
    effectiveEnd: points.at(-1)?.time ?? null,
    note: "Mock data source for chart debugging.",
    snapshot,
    points,
  };
}

function generateDailySeries(symbol: string, start: string, end: string) {
  const seed = createSeed(symbol);
  const rand = createRandom(seed);
  const results: CandlePoint[] = [];
  let close = 70 + (seed % 180);
  let cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let index = 0;

  while (cursor <= last) {
    const day = cursor.getUTCDay();

    if (day !== 0 && day !== 6) {
      const seasonal = Math.sin(index / 17) * 1.8 + Math.cos(index / 41) * 0.9;
      const drift = ((seed % 11) - 5) * 0.02;
      const move = seasonal + drift + (rand() - 0.5) * 3.4;
      const open = Math.max(5, close + (rand() - 0.5) * 2.2);
      close = Math.max(5, open + move);
      const high = Math.max(open, close) + rand() * 2.6;
      const low = Math.max(1, Math.min(open, close) - rand() * 2.4);
      const volume = Math.round(4_000_000 + rand() * 35_000_000 + Math.abs(move) * 1_200_000);

      results.push({
        time: cursor.toISOString(),
        open: roundPrice(open),
        high: roundPrice(high),
        low: roundPrice(low),
        close: roundPrice(close),
        volume,
      });

      index += 1;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return results;
}

function aggregateSeries(points: CandlePoint[], interval: ChartDataRequest["interval"]) {
  if (interval === "1d") {
    return points;
  }

  const buckets = new Map<string, CandlePoint[]>();

  for (const point of points) {
    const key = interval === "1wk" ? weekBucketKey(point.time) : monthBucketKey(point.time);
    const bucket = buckets.get(key) ?? [];
    bucket.push(point);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].map((bucket) => {
    const first = bucket[0];
    const last = bucket.at(-1) as CandlePoint;

    return {
      time: last.time,
      open: first.open,
      high: Math.max(...bucket.map((item) => item.high)),
      low: Math.min(...bucket.map((item) => item.low)),
      close: last.close,
      volume: bucket.reduce((sum, item) => sum + item.volume, 0),
    };
  });
}

function buildMockSnapshot(symbol: string, points: CandlePoint[]): AssetSnapshot {
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const regularMarketPrice = latest?.close ?? null;
  const previousClose = previous?.close ?? null;
  const change = regularMarketPrice !== null && previousClose !== null ? regularMarketPrice - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;

  return {
    symbol,
    shortName: `${symbol} Mock`,
    longName: `${symbol} Mock Debug Feed`,
    currency: "USD",
    exchange: "MOCK",
    quoteType: "DEBUG",
    marketState: "SIMULATED",
    regularMarketPrice,
    previousClose,
    change,
    changePercent,
    dayHigh: latest?.high ?? null,
    dayLow: latest?.low ?? null,
    open: latest?.open ?? null,
    volume: latest?.volume ?? null,
    fiftyTwoWeekHigh: maxValue(points, "high"),
    fiftyTwoWeekLow: minValue(points, "low"),
    regularMarketTime: latest ? Math.floor(new Date(latest.time).getTime() / 1000) : null,
  };
}

function weekBucketKey(value: string) {
  const date = new Date(value);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function monthBucketKey(value: string) {
  return value.slice(0, 7);
}

function createSeed(symbol: string) {
  return symbol.split("").reduce((total, char) => total * 31 + char.charCodeAt(0), 17) >>> 0;
}

function createRandom(seed: number) {
  let value = seed || 1;

  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function roundPrice(value: number) {
  return Math.round(value * 10000) / 10000;
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
