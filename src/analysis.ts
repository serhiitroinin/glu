import type { GlucoseReading, TirAnalysis } from "./types.ts";

/** mg/dL → mmol/L, rounded to 1 decimal. */
export function mgToMmol(mg: number): number {
  return Math.round(mg / 18.0 * 10) / 10;
}

/**
 * Compute time-in-range statistics from a set of glucose readings.
 * Pure: no I/O, deterministic for a given input. Range bands follow the
 * standard CGM cut-points (54 / 70 / 180 / 250 mg/dL).
 */
export function computeTir(readings: GlucoseReading[], source: string): TirAnalysis {
  const values = readings.map((r) => r.mgPerDl);
  const n = values.length;
  if (n === 0) {
    return {
      source, readings: 0, mean: 0, meanMmol: 0, sd: 0, cv: 0, gmi: 0,
      min: 0, max: 0, veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0,
      tirPct: 0, tbrPct: 0, tarPct: 0, veryLowPct: 0, lowPct: 0, highPct: 0, veryHighPct: 0,
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const cv = (sd / mean) * 100;
  const gmi = (mean + 46.7) / 28.7;

  const veryLow = values.filter((v) => v < 54).length;
  const low = values.filter((v) => v >= 54 && v < 70).length;
  const inRange = values.filter((v) => v >= 70 && v <= 180).length;
  const high = values.filter((v) => v > 180 && v <= 250).length;
  const veryHigh = values.filter((v) => v > 250).length;

  const pct = (count: number) => Math.round(count * 1000 / n) / 10;

  return {
    source,
    readings: n,
    mean: Math.round(mean),
    meanMmol: mgToMmol(mean),
    sd: Math.round(sd * 10) / 10,
    cv: Math.round(cv * 10) / 10,
    gmi: Math.round(gmi * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
    veryLow,
    low,
    inRange,
    high,
    veryHigh,
    tirPct: pct(inRange),
    tbrPct: pct(veryLow + low),
    tarPct: pct(high + veryHigh),
    veryLowPct: pct(veryLow),
    lowPct: pct(low),
    highPct: pct(high),
    veryHighPct: pct(veryHigh),
  };
}
