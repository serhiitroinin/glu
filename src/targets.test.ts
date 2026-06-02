import { test, expect } from "bun:test";
import { mergeTargets, overriddenKeys, DEFAULT_TARGETS } from "./targets.ts";

test("defaults match the 2019 consensus", () => {
  expect(DEFAULT_TARGETS.tirMin).toBe(70);
  expect(DEFAULT_TARGETS.tbrMax).toBe(4);
  expect(DEFAULT_TARGETS.tbrVeryLowMax).toBe(1);
  expect(DEFAULT_TARGETS.tarMax).toBe(25);
  expect(DEFAULT_TARGETS.cvMax).toBe(36);
});

test("mergeTargets with no overrides returns a copy of the defaults", () => {
  const merged = mergeTargets(DEFAULT_TARGETS, null);
  expect(merged).toEqual(DEFAULT_TARGETS);
  expect(merged).not.toBe(DEFAULT_TARGETS); // copy, not the same reference
});

test("mergeTargets applies a partial override, leaving the rest at default", () => {
  const merged = mergeTargets(DEFAULT_TARGETS, { tirMin: 80, cvMax: 33 });
  expect(merged.tirMin).toBe(80);
  expect(merged.cvMax).toBe(33);
  expect(merged.tbrMax).toBe(DEFAULT_TARGETS.tbrMax); // untouched
});

test("mergeTargets ignores non-numeric and unknown keys", () => {
  const overrides: Record<string, unknown> = { tirMin: NaN, bogus: 99, gmiMax: "high" };
  const merged = mergeTargets(DEFAULT_TARGETS, overrides as Partial<typeof DEFAULT_TARGETS>);
  expect(merged.tirMin).toBe(DEFAULT_TARGETS.tirMin); // NaN rejected
  expect(merged.gmiMax).toBe(DEFAULT_TARGETS.gmiMax); // non-number rejected
  expect("bogus" in merged).toBe(false);
});

test("overriddenKeys reports exactly which fields differ from default", () => {
  const merged = mergeTargets(DEFAULT_TARGETS, { tirMin: 80 });
  expect(overriddenKeys(merged)).toEqual(["tirMin"]);
  expect(overriddenKeys(mergeTargets(DEFAULT_TARGETS, null))).toEqual([]);
});
