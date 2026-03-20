import type { NextRequest } from "next/server";
import type { ChartDataRequest, ChartInterval, MarketDataSource, RangePreset } from "@/lib/market-types";

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
export const DEFAULT_DATA_SOURCE: MarketDataSource = "yahoo";

export type FetchWindow = {
  start: string | null;
  end: string | null;
  note: string | null;
};

export function getSearchQuery(request: NextRequest) {
  return request.nextUrl.searchParams.get("q")?.trim() ?? "";
}

export function getRequestDataSource(request: NextRequest) {
  return validateDataSource(request.nextUrl.searchParams.get("source"));
}

export function getChartQuery(request: NextRequest): ChartDataRequest {
  const params = request.nextUrl.searchParams;

  return {
    symbol: normalizeSymbol(params.get("symbol")),
    interval: validateInterval(params.get("interval")),
    source: validateDataSource(params.get("source")),
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

export function resolveFetchWindow(interval: ChartInterval, start: string | null, end: string | null) {
  if (start && end) {
    if (start <= end) {
      return buildBufferedWindow(interval, start, end);
    }

    return buildBufferedWindow(interval, end, start, "开始日期晚于结束日期，已自动交换。");
  }

  return {
    start: null,
    end: null,
    note: defaultFetchNote(interval),
  } satisfies FetchWindow;
}

export function buildBufferedWindow(interval: ChartInterval, start: string, end: string, note: string | null = null) {
  const spanDays = Math.max(30, Math.ceil((toUtcMillis(end) - toUtcMillis(start)) / 86400000));
  const bufferDays =
    interval === "1d"
      ? Math.max(730, spanDays * 3)
      : interval === "1wk"
        ? Math.max(365 * 5, spanDays * 5)
        : Math.max(365 * 12, spanDays * 8);

  return {
    start: shiftDate(end, -bufferDays),
    end,
    note: note ?? defaultFetchNote(interval),
  } satisfies FetchWindow;
}

export function toUtcMillis(value: string) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

export function shiftDate(value: string, deltaDays: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function defaultFetchNote(interval: ChartInterval) {
  if (interval === "1d") {
    return "日线会预取更长历史区间作为缩放缓冲。";
  }

  if (interval === "1wk") {
    return "周线会预取更长历史区间，避免被压缩成季度级别。";
  }

  return "月线会预取更长历史区间，缩放时优先使用缓存数据。";
}

function validateInterval(value: string | null): ChartInterval {
  const allowed: ChartInterval[] = ["1d", "1wk", "1mo"];
  return allowed.includes(value as ChartInterval) ? (value as ChartInterval) : DEFAULT_INTERVAL;
}

function validateRange(value: string | null): RangePreset {
  const allowed: RangePreset[] = ["1mo", "3mo", "6mo", "1y", "3y", "5y", "max"];
  return allowed.includes(value as RangePreset) ? (value as RangePreset) : DEFAULT_RANGE;
}

function validateDataSource(value: string | null): MarketDataSource {
  const allowed: MarketDataSource[] = ["yahoo", "mock"];
  return allowed.includes(value as MarketDataSource) ? (value as MarketDataSource) : DEFAULT_DATA_SOURCE;
}

function normalizeDateInput(value: string | null) {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
