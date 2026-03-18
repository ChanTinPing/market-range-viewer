"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { CandlestickChart } from "@/components/candlestick-chart";
import styles from "@/components/stock-dashboard.module.css";
import { DEFAULT_INTERVAL, DEFAULT_RANGE, DEFAULT_SYMBOL, defaultDateRange } from "@/lib/market";
import type { ChartInterval, ChartPayload, RangePreset, SearchResult } from "@/lib/market-types";

const RANGE_OPTIONS: RangePreset[] = ["1mo", "3mo", "6mo", "1y", "3y", "5y", "max"];
const INTERVAL_OPTIONS: Array<{ label: string; value: ChartInterval }> = [
  { label: "分时", value: "5m" },
  { label: "日K", value: "1d" },
  { label: "周K", value: "1wk" },
  { label: "月K", value: "1mo" },
];
const MARKET_GUIDE = [
  { label: "美股", symbol: "AAPL" },
  { label: "港股", symbol: "0700.HK" },
  { label: "马股", symbol: "5183.KL" },
  { label: "外汇", symbol: "EURUSD=X" },
  { label: "黄金", symbol: "GC=F" },
  { label: "比特币", symbol: "BTC-USD" },
];

const STORAGE_KEY = "market-range-viewer.watchlist";

export function StockDashboard() {
  const initialDates = defaultDateRange(DEFAULT_RANGE);
  const [draftSymbol, setDraftSymbol] = useState(DEFAULT_SYMBOL);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval] = useState<ChartInterval>(DEFAULT_INTERVAL);
  const [range, setRange] = useState<RangePreset>(DEFAULT_RANGE);
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);
  const [chartData, setChartData] = useState<ChartPayload | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [movingAverages, setMovingAverages] = useState<number[]>([5, 20, 60]);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const deferredQuery = useDeferredValue(draftSymbol.trim());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    const controller = new AbortController();
    async function runSearch() {
      if (!deferredQuery || deferredQuery.toUpperCase() === selectedSymbol.toUpperCase()) {
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
    const params = new URLSearchParams({
      symbol: selectedSymbol,
      interval,
      range,
    });

    if (startDate && endDate) {
      params.set("start", startDate);
      params.set("end", endDate);
    }

    async function loadChart() {
      setChartLoading(true);
      setChartError(null);

      try {
        const response = await fetch(`/api/chart?${params.toString()}`, { signal: controller.signal });
        const payload = (await response.json()) as ChartPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Chart request failed");
        }

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
  }, [endDate, interval, range, selectedSymbol, startDate]);

  const isWatched = watchlist.includes(selectedSymbol);
  const displayName = chartData?.snapshot.longName || chartData?.snapshot.shortName || selectedSymbol;
  const change = chartData?.snapshot.change ?? null;
  const changeClass = (change ?? 0) >= 0 ? styles.changePositive : styles.changeNegative;
  const showSearchResults = !!deferredQuery && deferredQuery.toUpperCase() !== selectedSymbol.toUpperCase();
  const rangeLabel = useMemo(() => {
    if (startDate && endDate) {
      return `${startDate} -> ${endDate}`;
    }

    return range.toUpperCase();
  }, [endDate, range, startDate]);

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

  function applyPreset(nextRange: RangePreset) {
    const nextDates = defaultDateRange(nextRange);
    setRange(nextRange);
    setStartDate(nextDates.start);
    setEndDate(nextDates.end);
  }

  function applyCustomDates() {
    if (!startDate || !endDate) {
      return;
    }

    setRange("max");
  }

  function resetToPreset() {
    const nextRange = range === "max" ? DEFAULT_RANGE : range;
    const nextDates = defaultDateRange(nextRange);
    setRange(nextRange);
    setStartDate(nextDates.start);
    setEndDate(nextDates.end);
  }

  function toggleMovingAverage(period: number) {
    setMovingAverages((current) =>
      current.includes(period) ? current.filter((item) => item !== period) : [...current, period].sort((a, b) => a - b),
    );
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
        <section className={styles.hero}>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.eyebrow}>Flexible Market Viewer</p>
              <h1 className={styles.heroTitle}>一页里自由拖、自由缩、自由选时间范围看全球行情</h1>
              <p className={styles.heroText}>
                这个网页版本专门解决常见股票 App 时间范围受限的问题。你可以同时用预设区间、自定义日期、K
                线拖拽缩放，以及分时 / 日K / 周K / 月K 四种视图来查股票、外汇、货币和大宗商品。
              </p>
              <div className={styles.chips}>
                <span className={styles.chip}>手机电脑自适应</span>
                <span className={styles.chip}>可直接部署上网</span>
                <span className={styles.chip}>支持全球常见代码</span>
                <span className={styles.chip}>免费公开数据代理</span>
              </div>
            </div>
            <aside className={styles.guideCard}>
              <h2>常用代码示例</h2>
              <div className={styles.guideList}>
                {MARKET_GUIDE.map((item) => (
                  <button key={item.symbol} type="button" className={styles.guideItem} onClick={() => submitSymbol(item.symbol)}>
                    <span>{item.label}</span>
                    <code>{item.symbol}</code>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <div className={styles.layout}>
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
                      {searchLoading && <div className={styles.subtle}>正在搜索…</div>}
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
                {MARKET_GUIDE.map((item) => (
                  <button key={item.symbol} type="button" className={styles.hintChip} onClick={() => submitSymbol(item.symbol)}>
                    {item.symbol}
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
                <div className={styles.badge}>{chartData?.snapshot.exchange || "Loading"}</div>
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

              <div className={styles.quoteGrid}>
                <StatCard label="查看区间" value={rangeLabel} />
                <StatCard label="今日开盘" value={formatMaybe(chartData?.snapshot.open)} />
                <StatCard label="区间最高" value={formatMaybe(chartData?.snapshot.dayHigh)} />
                <StatCard label="区间最低" value={formatMaybe(chartData?.snapshot.dayLow)} />
                <StatCard label="昨收" value={formatMaybe(chartData?.snapshot.previousClose)} />
                <StatCard label="成交量" value={formatVolume(chartData?.snapshot.volume)} />
                <StatCard label="52周高" value={formatMaybe(chartData?.snapshot.fiftyTwoWeekHigh)} />
                <StatCard label="52周低" value={formatMaybe(chartData?.snapshot.fiftyTwoWeekLow)} />
              </div>
            </section>

            <section className={styles.chartCard}>
              <div className={styles.toolbar}>
                <div className={styles.toolbarRow}>
                  <span className={styles.toolbarLabel}>视图</span>
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

                <div className={styles.toolbarRow}>
                  <span className={styles.toolbarLabel}>预设时长</span>
                  {RANGE_OPTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`${styles.rangeButton} ${range === item ? styles.active : ""}`}
                      onClick={() => applyPreset(item)}
                    >
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className={styles.toolbarRow}>
                  <span className={styles.toolbarLabel}>自定义</span>
                  <div className={styles.dateGroup}>
                    <input className={styles.dateInput} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                    <span className={styles.subtle}>到</span>
                    <input className={styles.dateInput} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
                  <button
                    type="button"
                    className={`${styles.toggle} ${showVolume ? styles.active : ""}`}
                    onClick={() => setShowVolume((current) => !current)}
                  >
                    成交量
                  </button>
                  {[5, 20, 60].map((period) => (
                    <button
                      key={period}
                      type="button"
                      className={`${styles.toggle} ${movingAverages.includes(period) ? styles.active : ""}`}
                      onClick={() => toggleMovingAverage(period)}
                    >
                      MA{period}
                    </button>
                  ))}
                  <button type="button" className={styles.toggle} onClick={toggleWatchlist}>
                    {isWatched ? "移出自选" : "加入自选"}
                  </button>
                </div>
              </div>

              {chartData?.note && <p className={styles.note}>{chartData.note}</p>}
              {chartError && <p className={styles.note}>{chartError}</p>}

              <div className={styles.chartSurface}>
                {chartLoading || !chartData ? (
                  <div className={styles.panel}>
                    <p className={styles.panelText}>正在加载 {selectedSymbol} 的图表数据…</p>
                  </div>
                ) : chartData.points.length === 0 ? (
                  <div className={styles.panel}>
                    <p className={styles.panelText}>当前条件下没有可显示的数据，请尝试切换周期或时间范围。</p>
                  </div>
                ) : (
                  <CandlestickChart
                    data={chartData.points}
                    interval={interval}
                    showVolume={showVolume}
                    movingAverages={movingAverages}
                  />
                )}
              </div>
            </section>
          </div>

          <aside className={styles.sideColumn}>
            <section className={styles.panel}>
              <h2 className={styles.sectionTitle}>自选列表</h2>
              {watchlist.length === 0 ? (
                <p className={styles.emptyState}>还没有加入自选，先选一个品种再点“加入自选”。</p>
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

            <section className={styles.panel}>
              <h2 className={styles.sectionTitle}>这版已经支持什么</h2>
              <p className={styles.panelText}>
                1. 可搜索和直接输入全球常见行情代码。
                <br />
                2. 可用预设区间快速跳到 1 个月到最大范围。
                <br />
                3. 可手动选择开始和结束日期查看任意历史窗口。
                <br />
                4. 图表原生支持手势缩放、鼠标滚轮缩放和横向拖动。
                <br />
                5. 提供分时、日K、周K、月K，以及 MA 和成交量。
              </p>
            </section>

            <section className={styles.panel}>
              <h2 className={styles.sectionTitle}>上线建议</h2>
              <p className={styles.footerNote}>
                这是一个标准 Next.js 项目，后面最省事的部署方式就是直接推到 GitHub，再接到 Vercel。这样你电脑和手机都能直接通过网址访问，
                不需要自己常开本地电脑。
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statsLabel}>{label}</div>
      <div className={styles.statsValue}>{value}</div>
    </div>
  );
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
