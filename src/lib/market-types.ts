export type ChartInterval = "5m" | "1d" | "1wk" | "1mo";

export type RangePreset = "1mo" | "3mo" | "6mo" | "1y" | "3y" | "5y" | "max";

export type SearchResult = {
  symbol: string;
  shortName: string;
  longName: string;
  exchange: string;
  market: string;
  type: string;
};

export type CandlePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type VisibleWindow = {
  start: string | null;
  end: string | null;
};

export type VisibleWindowRequest = VisibleWindow & {
  version: number;
};

export type AssetSnapshot = {
  symbol: string;
  shortName: string;
  longName: string;
  currency: string;
  exchange: string;
  quoteType: string;
  marketState: string;
  regularMarketPrice: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  open: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  regularMarketTime: number | null;
};

export type ChartPayload = {
  symbol: string;
  interval: ChartInterval;
  range: string;
  start: string | null;
  end: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  note: string | null;
  snapshot: AssetSnapshot;
  points: CandlePoint[];
};
