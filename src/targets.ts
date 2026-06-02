import { readConfig } from "./lib/config.ts";

/**
 * Glycemic targets. Each field is a threshold; the comparison direction is
 * fixed by clinical convention (TIR/TIR-tight are "at least", the rest "below").
 * Percentages are 0–100; cv/gmi are percent values.
 */
export interface Targets {
  tirMin: number;          // TIR (70–180)   ≥ tirMin
  tbrMax: number;          // TBR (<70)      < tbrMax
  tbrVeryLowMax: number;   // <54            < tbrVeryLowMax
  tarMax: number;          // TAR (>180)     < tarMax
  tarVeryHighMax: number;  // >250           < tarVeryHighMax
  cvMax: number;           // CV             ≤ cvMax
  gmiMax: number;          // GMI            < gmiMax
}

/**
 * Defaults follow the 2019 International Consensus on Time in Range
 * (non-pregnant adults with type 1 / type 2 diabetes):
 *   TIR >70%, TBR <4% (<1% below 54), TAR <25% (<5% above 250), CV ≤36%.
 * GMI has no formal consensus target; <7% mirrors the common A1C goal.
 * Override any subset in ~/.config/glu/targets.json.
 */
export const DEFAULT_TARGETS: Targets = {
  tirMin: 70,
  tbrMax: 4,
  tbrVeryLowMax: 1,
  tarMax: 25,
  tarVeryHighMax: 5,
  cvMax: 36,
  gmiMax: 7,
};

/** Merge user overrides over the defaults. Pure — unknown/missing keys ignored. */
export function mergeTargets(defaults: Targets, overrides: Partial<Targets> | null | undefined): Targets {
  if (!overrides) return { ...defaults };
  const merged = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Targets)[]) {
    const v = overrides[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      merged[key] = v;
    }
  }
  return merged;
}

/** Effective targets: consensus defaults overlaid with ~/.config/glu/targets.json. */
export function loadTargets(): Targets {
  return mergeTargets(DEFAULT_TARGETS, readConfig<Partial<Targets>>("targets"));
}

/** Which fields differ from the consensus defaults (for display). */
export function overriddenKeys(targets: Targets): (keyof Targets)[] {
  return (Object.keys(DEFAULT_TARGETS) as (keyof Targets)[]).filter(
    (k) => targets[k] !== DEFAULT_TARGETS[k],
  );
}
