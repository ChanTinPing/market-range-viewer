"use client";

import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { CandlestickChart } from "@/components/candlestick-chart";
import styles from "@/components/stock-dashboard.module.css";
import {
  DEFAULT_INTERVAL,
  DEFAULT_RANGE,
  DEFAULT_SYMBOL,
  defaultDateRange,
  rangePresetDays,
} from "@/lib/market";
import type {
  CandlePoint,
  ChartInterval,
  ChartPayload,
  RangePreset,
  SearchResult,
  VisibleWindow,
  VisibleWindowRequest,
} from "@/lib/market-types";

const RANGE_OPTIONS: RangePreset[] = ["1mo", "3mo", "6mo", "1y", "3y", "5y", "max"];
const MA_PRESETS = [5, 20, 60];
const INTERVAL_OPTIONS: Array<{ label: string; value: ChartInterval }> = [
  { label: "日线", value: "1d" },
  { label: "周线", value: "1wk" },
  { label: "月线", value: "1mo" },
];
const MARKET_GUIDE = ["AAPL", "0700.HK", "5183.KL", "EURUSD=X", "GC=F", "BTC-USD"];

const STORAGE_KEY = "market-range-viewer.watchlist";

export function StockDashboard() {
  const initialDates = defaultDateRange(DEFAULT_RANGE);
  const chartCacheRef = useRef<Map<string, ChartPayload>>(new Map());
  const [draftSymbol, setDraftSymbol] = useState(DEFAULT_SYMBOL);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval] = useState<ChartInterval>(DEFAULT_INTERVAL);
  const [chartData, setChartData] = useState<ChartPayload | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [movingAverages, setMovingAverages] = useState<number[]>([5]);
  const [movingAverageDraft, setMovingAverageDraft] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const [presetSelection, setPresetSelection] = useState<RangePreset>(DEFAULT_RANGE);
  const [activePreset, setActivePreset] = useState<RangePreset | null>(DEFAULT_RANGE);
  const [dateInputs, setDateInputs] = useState(initialDates);
  const [viewWindow, setViewWindow] = useState<VisibleWindowRequest>({
    start: initialDates.start,
    end: initialDates.end,
    version: 0,
  });
  const deferredQuery = useDeferredValue(draftSymbol.trim());
  const chartCacheKey = `${selectedSymbol}:${interval}`;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    const controller = new AbortController();

    async function runSearch() {
      if (!deferredQuery || deferredQuery.toUpperCase() === selectedSymbol.toUpperCase()) {
        setSearchResults([]);
        return;
      }

      setSearchLoading(true);

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(deferredQuery)}`, { signal: controller.signal });
        const payload = (await response.json()) as { results?: SearchResult[] };
        setSearchResults(payload.results ?? []);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }

    void runSearch();

    return () => controller.abort();
  }, [deferredQuery, selectedSymbol]);

  useEffect(() => {
    const controller = new AbortController();
    const cached = chartCacheRef.current.get(chartCacheKey) ?? null;
    const fetchWindow = getFetchWindow(interval, viewWindow, cached);
    setChartError(null);

    if (cached && !fetchWindow) {
      setChartData(cached);
      setChartLoading(false);
      return () => controller.abort();
    }

    async function loadChart() {
      setChartLoading(true);

      try {
        const params = new URLSearchParams({
          symbol: selectedSymbol,
          interval,
        });

        if (fetchWindow?.start && fetchWindow?.end) {
          params.set("start", fetchWindow.start);
          params.set("end", fetchWindow.end);
        }

        const response = await fetch(`/api/chart?${params.toString()}`, { signal: controller.signal });
        const payload = (await response.json()) as ChartPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Chart request failed");
        }

        chartCacheRef.current.set(chartCacheKey, payload);
        setChartData(payload);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setChartError(error instanceof Error ? error.message : "加载行情失败");
      } finally {
        setChartLoading(false);
      }
    }

    void loadChart();

    return () => controller.abort();
  }, [chartCacheKey, interval, selectedSymbol, viewWindow]);

  useEffect(() => {
    if (!chartData) {
      return;
    }

    const nextPreset = detectPreset(windowForPreset(viewWindow, chartData), chartData.points);
    setActivePreset(nextPreset);
  }, [chartData, viewWindow]);

  useEffect(() => {
    if (!chartData || !viewWindow.start || !viewWindow.end) {
      return;
    }

    const nextInputs = {
      start: toInputDate(viewWindow.start),
      end: toInputDate(viewWindow.end),
    };

    setDateInputs((current) => (sameInputWindow(current, nextInputs) ? current : nextInputs));
    setActivePreset(detectPreset(nextInputs, chartData.points));
  }, [chartData, viewWindow]);

  const isWatched = watchlist.includes(selectedSymbol);
  const displayName = chartData?.snapshot.longName || chartData?.snapshot.shortName || selectedSymbol;
  const change = chartData?.snapshot.change ?? null;
  const changeClass = (change ?? 0) >= 0 ? styles.changePositive : styles.changeNegative;
  const showSearchResults = !!deferredQuery && deferredQuery.toUpperCase() !== selectedSymbol.toUpperCase();
  const visiblePoints = chartData ? filterVisiblePoints(chartData.points, viewWindow) : [];
  const pointsForMetrics = visiblePoints.length > 0 ? visiblePoints : chartData?.points ?? [];

  function submitSymbol(symbol: string) {
    const nextSymbol = symbol.trim().toUpperCase();

    if (!nextSymbol) {
      return;
    }

    startTransition(() => {
      setSelectedSymbol(nextSymbol);
      setDraftSymbol(nextSymbol);
      setSearchResults([]);
    });
  }

  function pushVisibleWindow(window: { start: string | null; end: string | null }) {
    setViewWindow((current) => ({
      start: window.start,
      end: window.end,
      version: current.version + 1,
    }));
  }

  function applyPreset(nextRange: RangePreset) {
    setPresetSelection(nextRange);

    if (nextRange === "max" && chartData?.points.length) {
      const nextWindow = {
        start: chartData.points[0]?.time ?? null,
        end: chartData.points.at(-1)?.time ?? null,
      };

      setActivePreset("max");
      setDateInputs({
        start: toInputDate(nextWindow.start),
        end: toInputDate(nextWindow.end),
      });
      pushVisibleWindow(nextWindow);
      return;
    }

    const nextDates = defaultDateRange(nextRange);
    setActivePreset(nextRange);
    setDateInputs(nextDates);
    pushVisibleWindow(nextDates);
  }

  function applyCustomDates() {
    const normalized = normalizeDateInputs(dateInputs.start, dateInputs.end);

    if (!normalized) {
      return;
    }

    setDateInputs(normalized);
    setActivePreset(chartData ? detectPreset(normalized, chartData.points) : null);
    pushVisibleWindow(normalized);
  }

  function resetToPreset() {
    applyPreset(presetSelection);
  }

  function toggleMovingAverage(period: number) {
    setMovingAverages((current) =>
      current.includes(period) ? current.filter((item) => item !== period) : [...current, period].sort((a, b) => a - b),
    );
  }

  function addMovingAverage() {
    const nextPeriod = Number(movingAverageDraft);

    if (!Number.isInteger(nextPeriod) || nextPeriod < 2 || nextPeriod > 240) {
      return;
    }

    setMovingAverages((current) =>
      current.includes(nextPeriod) ? current : [...current, nextPeriod].sort((a, b) => a - b),
    );
    setMovingAverageDraft("");
  }

  function toggleWatchlist() {
    setWatchlist((current) =>
      current.includes(selectedSymbol)
        ? current.filter((item) => item !== selectedSymbol)
        : [selectedSymbol, ...current].slice(0, 12),
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.topGrid}>
          <div className={styles.mainColumn}>
            <section className={styles.searchCard}>
              <div className={styles.searchRow}>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.searchInput}
                    value={draftSymbol}
                    placeholder="输入代码或名称，例如 AAPL / 0700.HK / 5183.KL / EURUSD=X / GC=F"
                    onChange={(event) => setDraftSymbol(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        submitSymbol(draftSymbol);
                      }
                    }}
                  />

                  {showSearchResults && (searchResults.length > 0 || searchLoading) && (
                    <div className={styles.results}>
                      {searchLoading && <div className={styles.subtle}>正在搜索...</div>}
                      {searchResults.map((result) => (
                        <button
                          key={`${result.symbol}-${result.exchange}`}
                          type="button"
                          className={styles.resultButton}
                          onClick={() => submitSymbol(result.symbol)}
                        >
                          <div className={styles.resultSymbol}>{result.symbol}</div>
                          <div>{result.longName || result.shortName}</div>
                          <div className={styles.resultMeta}>
                            {result.exchange || "Unknown"} · {result.type || "Asset"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button type="button" className={styles.primaryButton} onClick={() => submitSymbol(draftSymbol)}>
                  查看行情
                </button>
              </div>

              <div className={styles.hintRow}>
                {MARKET_GUIDE.map((symbol) => (
                  <button key={symbol} type="button" className={styles.hintChip} onClick={() => submitSymbol(symbol)}>
                    {symbol}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.quoteCard}>
              <div className={styles.quoteHeader}>
                <div>
                  <h2 className={styles.symbol}>{selectedSymbol}</h2>
                  <p className={styles.company}>{displayName}</p>
                </div>

                <div className={styles.quoteActions}>
                  <button
                    type="button"
                    className={`${styles.watchToggle} ${isWatched ? styles.active : ""}`}
                    onClick={toggleWatchlist}
                  >
                    {isWatched ? "已在自选" : "加入自选"}
                  </button>
                  <div className={styles.badge}>{chartData?.snapshot.exchange || "Loading"}</div>
                </div>
              </div>

              <div className={styles.priceRow}>
                <span className={styles.price}>{formatPrice(chartData?.snapshot.regularMarketPrice, chartData?.snapshot.currency)}</span>
                <span className={changeClass}>
                  {formatSigned(change)} ({formatPercent(chartData?.snapshot.changePercent)})
                </span>
                <span className={styles.subtle}>
                  {chartData?.snapshot.quoteType || "Asset"} · {chartData?.snapshot.marketState || "Market"}
                </span>
              </div>

              <div className={styles.metricsList}>
                <MetricItem label="今日开盘" value={formatMaybe(chartData?.snapshot.open)} />
                <MetricItem label="昨收" value={formatMaybe(chartData?.snapshot.previousClose)} />
                <MetricItem label="区间最高" value={formatMaybe(maxPointValue(pointsForMetrics, "high"))} />
                <MetricItem label="区间最低" value={formatMaybe(minPointValue(pointsForMetrics, "low"))} />
                <MetricItem label="成交量" value={formatVolume(chartData?.snapshot.volume)} />
                <MetricItem label="52周高" value={formatMaybe(chartData?.snapshot.fiftyTwoWeekHigh)} />
                <MetricItem label="52周低" value={formatMaybe(chartData?.snapshot.fiftyTwoWeekLow)} />
              </div>
            </section>
          </div>

          <aside className={styles.sideColumn}>
            <section className={`${styles.panel} ${styles.watchPanel}`}>
              <h2 className={styles.sectionTitle}>自选列表</h2>

              {watchlist.length === 0 ? (
                <p className={styles.emptyState}>还没有加入自选，先选择一个品种再加入到这里。</p>
              ) : (
                <div className={styles.watchlist}>
                  {watchlist.map((symbol) => (
                    <button key={symbol} type="button" className={styles.watchButton} onClick={() => submitSymbol(symbol)}>
                      <code>{symbol}</code>
                      <span>查看</span>
                    </button>
                  ))}
                </div>
              )}

              <div className={styles.watchActions}>
                <button type="button" className={styles.ghostButton} onClick={() => setWatchlist([])}>
                  清空自选
                </button>
              </div>
            </section>
          </aside>
        </section>

        <section className={styles.chartCard}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarRow}>
              <span className={styles.toolbarLabel}>视图</span>
              <div className={styles.toolbarControls}>
                {INTERVAL_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`${styles.intervalButton} ${interval === item.value ? styles.active : ""}`}
                    onClick={() => setInterval(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.toolbarRow}>
              <span className={styles.toolbarLabel}>预设时长</span>
              <div className={styles.toolbarControls}>
                {RANGE_OPTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${styles.rangeButton} ${activePreset === item ? styles.active : ""}`}
                    onClick={() => applyPreset(item)}
                  >
                    {item.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.toolbarRow}>
              <span className={styles.toolbarLabel}>自定义</span>
              <div className={styles.dateGroup}>
                <input
                  className={styles.dateInput}
                  type="date"
                  value={dateInputs.start}
                  onChange={(event) => setDateInputs((current) => ({ ...current, start: event.target.value }))}
                />
                <span className={styles.subtle}>到</span>
                <input
                  className={styles.dateInput}
                  type="date"
                  value={dateInputs.end}
                  onChange={(event) => setDateInputs((current) => ({ ...current, end: event.target.value }))}
                />
                <button type="button" className={styles.primaryButton} onClick={applyCustomDates}>
                  应用日期
                </button>
                <button type="button" className={styles.ghostButton} onClick={resetToPreset}>
                  回到预设
                </button>
              </div>
            </div>

            <div className={styles.toolbarRow}>
              <span className={styles.toolbarLabel}>指标</span>
              <div className={styles.toolbarControls}>
                <button
                  type="button"
                  className={`${styles.toggle} ${showVolume ? styles.active : ""}`}
                  onClick={() => setShowVolume((current) => !current)}
                >
                  成交量
                </button>
                {MA_PRESETS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    className={`${styles.toggle} ${movingAverages.includes(period) ? styles.active : ""}`}
                    onClick={() => toggleMovingAverage(period)}
                  >
                    MA{period}
                  </button>
                ))}
                {movingAverages
                  .filter((period) => !MA_PRESETS.includes(period))
                  .map((period) => (
                    <button
                      key={period}
                      type="button"
                      className={`${styles.toggle} ${styles.customMaChip} ${styles.active}`}
                      onClick={() => toggleMovingAverage(period)}
                    >
                      MA{period}
                    </button>
                  ))}
                <div className={styles.maInputGroup}>
                  <input
                    className={styles.maInput}
                    inputMode="numeric"
                    value={movingAverageDraft}
                    placeholder="自定义 MA"
                    onChange={(event) => setMovingAverageDraft(event.target.value.replace(/[^\d]/g, ""))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addMovingAverage();
                      }
                    }}
                  />
                  <button type="button" className={styles.ghostButton} onClick={addMovingAverage}>
                    添加
                  </button>
                </div>
              </div>
            </div>
          </div>

          {chartError && <p className={styles.note}>{chartError}</p>}

          <div className={styles.chartSurface}>
            {chartData?.points.length ? (
              <>
                <CandlestickChart
                  key={`${selectedSymbol}-${interval}`}
                  data={chartData.points}
                  showVolume={showVolume}
                  movingAverages={movingAverages}
                  visibleWindow={viewWindow}
                />
                {chartLoading && (
                  <div className={styles.chartOverlay}>
                    <p className={styles.panelText}>正在更新 {selectedSymbol} 的图表数据...</p>
                  </div>
                )}
              </>
            ) : chartLoading ? (
              <div className={styles.panel}>
                <p className={styles.panelText}>正在加载 {selectedSymbol} 的图表数据...</p>
              </div>
            ) : (
              <div className={styles.panel}>
                <p className={styles.panelText}>当前条件下没有可显示的数据，请尝试切换周期或时间范围。</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricItem}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}

function getFetchWindow(interval: ChartInterval, requestedWindow: VisibleWindow, cached: ChartPayload | null) {
  const normalized = normalizeRequestedWindow(requestedWindow);

  if (!normalized) {
    return cached ? null : { start: null, end: null };
  }

  if (cached && cacheCoversWindow(cached, normalized)) {
    return null;
  }

  const spanDays = Math.max(30, diffDays(normalized.start, normalized.end));
  const bufferDays =
    interval === "1d"
      ? Math.max(365 * 2, spanDays * 3)
      : interval === "1wk"
        ? Math.max(365 * 5, spanDays * 5)
        : Math.max(365 * 12, spanDays * 8);
  const desiredStart = shiftDate(normalized.end, -bufferDays);
  const cacheStart = cached ? toInputDate(cached.points[0]?.time ?? null) : "";
  const cacheEnd = cached ? toInputDate(cached.points.at(-1)?.time ?? null) : "";

  return {
    start: cacheStart ? (desiredStart < cacheStart ? desiredStart : cacheStart) : desiredStart,
    end: cacheEnd && cacheEnd > normalized.end ? cacheEnd : normalized.end,
  };
}

function normalizeRequestedWindow(window: VisibleWindow) {
  if (!window.start || !window.end) {
    return null;
  }

  const start = toInputDate(window.start);
  const end = toInputDate(window.end);

  return normalizeDateInputs(start, end);
}

function cacheCoversWindow(chartData: ChartPayload, requestedWindow: { start: string; end: string }) {
  const cachedStart = toInputDate(chartData.points[0]?.time ?? null);
  const cachedEnd = toInputDate(chartData.points.at(-1)?.time ?? null);

  if (!cachedStart || !cachedEnd) {
    return false;
  }

  return requestedWindow.start >= cachedStart && requestedWindow.end <= cachedEnd;
}

function filterVisiblePoints(points: CandlePoint[], window: VisibleWindow) {
  if (!window.start || !window.end) {
    return points;
  }

  const start = toWindowTimestamp(window.start, true);
  const end = toWindowTimestamp(window.end, false);

  if (start === null || end === null) {
    return points;
  }

  return points.filter((point) => {
    const timestamp = new Date(point.time).getTime();
    return timestamp >= start && timestamp <= end;
  });
}

function detectPreset(window: { start: string; end: string } | null, points: CandlePoint[]) {
  if (!window || points.length === 0) {
    return null;
  }

  const availableStart = toInputDate(points[0]?.time ?? null);
  const availableEnd = toInputDate(points.at(-1)?.time ?? null);

  if (window.start <= availableStart && window.end >= availableEnd) {
    return "max";
  }

  const spanDays = Math.max(
    1,
    Math.round((new Date(`${window.end}T00:00:00Z`).getTime() - new Date(`${window.start}T00:00:00Z`).getTime()) / 86400000),
  );

  for (const preset of RANGE_OPTIONS) {
    if (preset === "max") {
      continue;
    }

    const days = rangePresetDays(preset);
    const drift = Math.abs(spanDays - days) / days;

    if (drift <= 0.14) {
      return preset;
    }
  }

  return null;
}

function normalizeDateInputs(start: string, end: string) {
  if (!start || !end) {
    return null;
  }

  if (start <= end) {
    return { start, end };
  }

  return { start: end, end: start };
}

function sameInputWindow(left: { start: string; end: string }, right: { start: string; end: string }) {
  return left.start === right.start && left.end === right.end;
}

function windowForPreset(window: VisibleWindow, chartData: ChartPayload) {
  if (window.start && window.end) {
    return {
      start: toInputDate(window.start),
      end: toInputDate(window.end),
    };
  }

  return {
    start: toInputDate(chartData.points[0]?.time ?? null),
    end: toInputDate(chartData.points.at(-1)?.time ?? null),
  };
}

function toInputDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

function toWindowTimestamp(value: string, isStart: boolean) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${isStart ? "00:00:00" : "23:59:59"}Z`).getTime();
  }

  return new Date(value).getTime();
}

function shiftDate(value: string, deltaDays: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function diffDays(start: string, end: string) {
  return Math.ceil((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000);
}

function maxPointValue(points: CandlePoint[], field: "high" | "open" | "close") {
  if (points.length === 0) {
    return null;
  }

  return Math.max(...points.map((point) => point[field]));
}

function minPointValue(points: CandlePoint[], field: "low" | "open" | "close") {
  if (points.length === 0) {
    return null;
  }

  return Math.min(...points.map((point) => point[field]));
}

function formatPrice(value: number | null | undefined, currency?: string) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 1000 ? 2 : 4,
  })}${currency ? ` ${currency}` : ""}`;
}

function formatMaybe(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 1000 ? 2 : 4,
  });
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSigned(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 2 : 4,
  })}`;
}

function formatVolume(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }

  return String(value);
}

function loadWatchlist() {
  if (typeof window === "undefined") {
    return [];
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return [];
  }

  try {
    return JSON.parse(saved) as string[];
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}
