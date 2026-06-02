import { test, expect } from "bun:test";
import { computeTir, mgToMmol } from "./analysis.ts";
import type { GlucoseReading } from "./types.ts";

function reading(mg: number): GlucoseReading {
  return { timestamp: "2026-01-01T00:00:00Z", mgPerDl: mg, mmolPerL: mgToMmol(mg), trendArrow: null, rangeLabel: "IN RANGE" };
}

test("mgToMmol converts and rounds to 1 decimal", () => {
  expect(mgToMmol(180)).toBe(10);
  expect(mgToMmol(100)).toBe(5.6);
});

test("computeTir on empty input returns a zeroed analysis", () => {
  const a = computeTir([], "empty");
  expect(a.readings).toBe(0);
  expect(a.tirPct).toBe(0);
  expect(a.mean).toBe(0);
});

test("computeTir buckets readings into the standard bands", () => {
  // 10 readings: 1 very-low, 1 low, 6 in-range, 1 high, 1 very-high
  const mgs = [50, 60, 80, 90, 100, 120, 150, 170, 200, 300];
  const a = computeTir(mgs.map(reading), "sample");

  expect(a.readings).toBe(10);
  expect(a.veryLow).toBe(1);   // <54
  expect(a.low).toBe(1);       // 54–69
  expect(a.inRange).toBe(6);   // 70–180
  expect(a.high).toBe(1);      // 181–250
  expect(a.veryHigh).toBe(1);  // >250

  expect(a.tirPct).toBe(60);
  expect(a.tbrPct).toBe(20);   // veryLow + low
  expect(a.tarPct).toBe(20);   // high + veryHigh
  expect(a.veryLowPct).toBe(10);
});

test("computeTir computes mean, min, max, and GMI", () => {
  const a = computeTir([reading(100), reading(100), reading(100)], "flat");
  expect(a.mean).toBe(100);
  expect(a.min).toBe(100);
  expect(a.max).toBe(100);
  expect(a.cv).toBe(0); // zero variance
  // GMI = (mean + 46.7) / 28.7 = (100 + 46.7)/28.7 ≈ 5.1
  expect(a.gmi).toBeCloseTo(5.1, 1);
});

test("boundary values land in the expected band (70 and 180 are in-range)", () => {
  const a = computeTir([reading(70), reading(180), reading(54), reading(53)], "edges");
  expect(a.inRange).toBe(2);  // 70 and 180 inclusive
  expect(a.low).toBe(1);      // 54
  expect(a.veryLow).toBe(1);  // 53
});
