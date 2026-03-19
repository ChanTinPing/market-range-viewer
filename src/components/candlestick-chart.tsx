"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { CandlePoint, VisibleWindowRequest } from "@/lib/market-types";

type CandlestickChartProps = {
  data: CandlePoint[];
  showVolume: boolean;
  movingAverages: number[];
  visibleWindow: VisibleWindowRequest;
};

type LineDatum = {
  time: Time;
  value: number;
};

export function CandlestickChart({ data, showVolume, movingAverages, visibleWindow }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const movingAverageRefs = useRef<Array<{ period: number; series: ISeriesApi<"Line"> }>>([]);
  const lastAppliedWindowVersionRef = useRef<number>(-1);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#c8d7e6",
      },
      grid: {
        vertLines: { color: "rgba(134, 172, 199, 0.08)" },
        horzLines: { color: "rgba(134, 172, 199, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(134, 172, 199, 0.15)",
      },
      timeScale: {
        borderColor: "rgba(134, 172, 199, 0.15)",
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 8,
        minBarSpacing: 0.25,
      },
      localization: {
        locale: "zh-CN",
      },
      crosshair: {
        vertLine: { color: "rgba(89, 199, 255, 0.4)" },
        horzLine: { color: "rgba(89, 199, 255, 0.4)" },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#4ce18f",
      downColor: "#ff7a78",
      wickUpColor: "#4ce18f",
      wickDownColor: "#ff7a78",
      borderVisible: false,
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(() => {
      chart.timeScale().applyOptions({
        timeVisible: false,
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      movingAverageRefs.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lastAppliedWindowVersionRef.current = -1;
    };
  }, []);

  useLayoutEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    const candles = data.map((point) => ({
      time: toChartTime(point.time),
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    }));

    const volumes = data.map((point) => ({
      time: toChartTime(point.time),
      value: point.volume,
      color: point.close >= point.open ? "rgba(76, 225, 143, 0.35)" : "rgba(255, 122, 120, 0.35)",
    }));

    candleSeriesRef.current.setData(candles);
    volumeSeriesRef.current.setData(showVolume ? volumes : []);
    syncMovingAverages(chartRef.current, movingAverageRefs, data, movingAverages);
  }, [data, showVolume, movingAverages]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) {
      return;
    }

    if (lastAppliedWindowVersionRef.current === visibleWindow.version) {
      return;
    }

    lastAppliedWindowVersionRef.current = visibleWindow.version;
    const nextRange = resolveLogicalRange(data, visibleWindow);

    requestAnimationFrame(() => {
      if (!chartRef.current) {
        return;
      }

      if (nextRange) {
        chartRef.current.timeScale().setVisibleLogicalRange(nextRange);
      } else {
        chartRef.current.timeScale().fitContent();
      }
    });
  }, [data, visibleWindow]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function syncMovingAverages(
  chart: IChartApi,
  refs: MutableRefObject<Array<{ period: number; series: ISeriesApi<"Line"> }>>,
  data: CandlePoint[],
  periods: number[],
) {
  const current = new Map(refs.current.map((item) => [item.period, item.series]));
  const nextItems: Array<{ period: number; series: ISeriesApi<"Line"> }> = [];

  for (const period of periods) {
    const existing = current.get(period);
    const series =
      existing ??
      chart.addSeries(LineSeries, {
        color: movingAverageColor(period),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    series.setData(computeMovingAverage(data, period));
    nextItems.push({ period, series });
    current.delete(period);
  }

  current.forEach((series) => chart.removeSeries(series));
  refs.current = nextItems;
}

function computeMovingAverage(data: CandlePoint[], period: number): LineDatum[] {
  const result: LineDatum[] = [];

  for (let index = period - 1; index < data.length; index += 1) {
    const window = data.slice(index - period + 1, index + 1);
    const sum = window.reduce((total, point) => total + point.close, 0);
    result.push({
      time: toChartTime(data[index].time),
      value: sum / period,
    });
  }

  return result;
}

function resolveLogicalRange(data: CandlePoint[], visibleWindow: VisibleWindowRequest) {
  if (data.length === 0 || !visibleWindow.start || !visibleWindow.end) {
    return null;
  }

  const normalizedStart = toWindowTimestamp(visibleWindow.start, true);
  const normalizedEnd = toWindowTimestamp(visibleWindow.end, false);

  if (normalizedStart === null || normalizedEnd === null) {
    return null;
  }

  const fromIndex = findFirstIndexOnOrAfter(data, normalizedStart);
  const toIndex = findLastIndexOnOrBefore(data, normalizedEnd);

  if (fromIndex > toIndex) {
    return null;
  }

  return {
    from: Math.max(0, fromIndex - 0.5),
    to: Math.min(data.length - 1 + 0.5, toIndex + 0.5),
  };
}

function findFirstIndexOnOrAfter(data: CandlePoint[], target: number) {
  let left = 0;
  let right = data.length - 1;
  let answer = data.length - 1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const value = new Date(data[middle].time).getTime();

    if (value >= target) {
      answer = middle;
      right = middle - 1;
    } else {
      left = middle + 1;
    }
  }

  return answer;
}

function findLastIndexOnOrBefore(data: CandlePoint[], target: number) {
  let left = 0;
  let right = data.length - 1;
  let answer = 0;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const value = new Date(data[middle].time).getTime();

    if (value <= target) {
      answer = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return answer;
}

function toWindowTimestamp(value: string, isStart: boolean) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${isStart ? "00:00:00" : "23:59:59"}Z`).getTime();
  }

  return new Date(value).getTime();
}

function movingAverageColor(period: number) {
  if (period === 5) {
    return "#59c7ff";
  }

  if (period === 20) {
    return "#ffcd6b";
  }

  return "#c293ff";
}

function toChartTime(value: string): Time {
  return value.slice(0, 10) as Time;
}
