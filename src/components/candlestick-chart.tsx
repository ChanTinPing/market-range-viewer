"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { CandlePoint } from "@/lib/market-types";

type CandlestickChartProps = {
  data: CandlePoint[];
  interval: string;
  showVolume: boolean;
  movingAverages: number[];
};

type LineDatum = {
  time: Time;
  value: number;
};

export function CandlestickChart({
  data,
  interval,
  showVolume,
  movingAverages,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const movingAverageRefs = useRef<Array<{ period: number; series: ISeriesApi<"Line"> }>>([]);

  useEffect(() => {
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
        timeVisible: interval === "5m",
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
      handleScroll: true,
      handleScale: true,
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
      chart.timeScale().fitContent();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      movingAverageRefs.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [interval]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    const candles = data.map((point) => ({
      time: toChartTime(point.time, interval),
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    }));

    const volumes = data.map((point) => ({
      time: toChartTime(point.time, interval),
      value: point.volume,
      color: point.close >= point.open ? "rgba(76, 225, 143, 0.35)" : "rgba(255, 122, 120, 0.35)",
    }));

    candleSeriesRef.current.setData(candles);
    volumeSeriesRef.current.setData(showVolume ? volumes : []);

    syncMovingAverages(chartRef.current, movingAverageRefs, data, interval, movingAverages);
    chartRef.current.timeScale().fitContent();
  }, [data, interval, movingAverages, showVolume]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function syncMovingAverages(
  chart: IChartApi,
  refs: MutableRefObject<Array<{ period: number; series: ISeriesApi<"Line"> }>>,
  data: CandlePoint[],
  interval: string,
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

    series.setData(computeMovingAverage(data, period, interval));
    nextItems.push({ period, series });
    current.delete(period);
  }

  current.forEach((series) => chart.removeSeries(series));
  refs.current = nextItems;
}

function computeMovingAverage(data: CandlePoint[], period: number, interval: string): LineDatum[] {
  const result: LineDatum[] = [];

  for (let index = period - 1; index < data.length; index += 1) {
    const window = data.slice(index - period + 1, index + 1);
    const sum = window.reduce((total, point) => total + point.close, 0);
    result.push({
      time: toChartTime(data[index].time, interval),
      value: sum / period,
    });
  }

  return result;
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

function toChartTime(value: string, interval: string): Time {
  if (interval === "5m") {
    return Math.floor(new Date(value).getTime() / 1000) as Time;
  }

  return value.slice(0, 10) as Time;
}
