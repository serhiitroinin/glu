/** Provider-agnostic types for the glu CLI */

export type TrendArrow = "↓↓" | "↓" | "→" | "↑" | "↑↑" | "?";
export type RangeLabel = "VERY LOW" | "LOW" | "IN RANGE" | "HIGH" | "VERY HIGH";

export interface GlucoseReading {
  timestamp: string;
  mgPerDl: number;
  mmolPerL: number;
  trendArrow: TrendArrow | null;
  rangeLabel: RangeLabel;
}

export interface TirAnalysis {
  source: string;
  readings: number;
  mean: number;
  meanMmol: number;
  sd: number;
  cv: number;
  gmi: number;
  min: number;
  max: number;
  veryLow: number;   // count <54
  low: number;        // count 54-69
  inRange: number;    // count 70-180
  high: number;       // count 181-250
  veryHigh: number;   // count >250
  tirPct: number;
  tbrPct: number;
  tarPct: number;
  veryLowPct: number;
  lowPct: number;
  highPct: number;
  veryHighPct: number;
}

/** Every CGM data provider must implement this interface */
export interface GlucoseProvider {
  name: string;

  current(): Promise<GlucoseReading>;
  graph(): Promise<{ current: GlucoseReading | null; readings: GlucoseReading[] }>;
  logbook(): Promise<GlucoseReading[]>;
  tir(source: "graph" | "logbook"): Promise<TirAnalysis>;
  json(path: string): Promise<unknown>;
}
