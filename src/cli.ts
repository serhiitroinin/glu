#!/usr/bin/env bun
import { Command } from "commander";
import { setSecret, getSecret, hasSecret } from "./lib/keychain.ts";
import { readSecret } from "./lib/prompt.ts";
import * as out from "./lib/output.ts";
import { libreProvider, login } from "./providers/libre.ts";
import { loadTargets, overriddenKeys, type Targets } from "./targets.ts";
import { getModuleConfigPath } from "./lib/config.ts";
import type { GlucoseProvider, TirAnalysis } from "./types.ts";

const provider: GlucoseProvider = libreProvider;

// ── Formatting helpers ───────────────────────────────────────────

type Op = "gte" | "lt" | "lte";

function passes(value: number, target: number, op: Op): boolean {
  if (op === "gte") return value >= target;
  if (op === "lte") return value <= target;
  return value < target;
}

function tirTarget(value: number, target: number, op: Op): string {
  return passes(value, target, op) ? "✓ PASS" : `✗ MISS (${value}%)`;
}

function printTir(tir: TirAnalysis, targets: Targets = loadTargets()): void {
  out.info(`Readings:  ${tir.readings}`);
  out.blank();

  console.log("── Glucose ──────────────────────────");
  console.log(`  Mean:    ${tir.mean} mg/dL (${tir.meanMmol} mmol/L)`);
  console.log(`  SD:      ${tir.sd} mg/dL`);
  console.log(`  CV:      ${tir.cv}%${passes(tir.cv, targets.cvMax, "lte") ? " ✓" : " ✗"}`);
  console.log(`  Min:     ${tir.min} mg/dL  Max: ${tir.max} mg/dL`);
  console.log(`  GMI:     ${tir.gmi}%`);
  out.blank();

  console.log("── Time in Range ────────────────────");
  console.log(`  Very Low  (<54):     ${tir.veryLowPct}%  (${tir.veryLow}/${tir.readings})${passes(tir.veryLowPct, targets.tbrVeryLowMax, "lt") ? " ✓" : " ✗"}`);
  console.log(`  Low       (54-69):   ${tir.lowPct}%  (${tir.low}/${tir.readings})`);
  console.log(`  TBR total (<70):     ${tir.tbrPct}%${passes(tir.tbrPct, targets.tbrMax, "lt") ? " ✓" : " ✗"}`);
  console.log(`  In Range  (70-180):  ${tir.tirPct}%  (${tir.inRange}/${tir.readings})${passes(tir.tirPct, targets.tirMin, "gte") ? " ✓" : " ✗"}`);
  console.log(`  High      (181-250): ${tir.highPct}%  (${tir.high}/${tir.readings})`);
  console.log(`  Very High (>250):    ${tir.veryHighPct}%  (${tir.veryHigh}/${tir.readings})`);
  out.blank();

  const overridden = overriddenKeys(targets);
  const srcNote = overridden.length ? `${overridden.length} override${overridden.length === 1 ? "" : "s"}` : "2019 consensus";
  console.log(`── Targets (${srcNote}) ─────────────`);
  console.log(`  TIR  ≥${targets.tirMin}%:  ${tirTarget(tir.tirPct, targets.tirMin, "gte")}`);
  console.log(`  TBR  <${targets.tbrMax}%:   ${tirTarget(tir.tbrPct, targets.tbrMax, "lt")}`);
  console.log(`  <54  <${targets.tbrVeryLowMax}%:   ${tirTarget(tir.veryLowPct, targets.tbrVeryLowMax, "lt")}`);
  console.log(`  TAR  <${targets.tarMax}%:  ${tirTarget(tir.tarPct, targets.tarMax, "lt")}`);
  console.log(`  >250 <${targets.tarVeryHighMax}%:   ${tirTarget(tir.veryHighPct, targets.tarVeryHighMax, "lt")}`);
  console.log(`  CV   ≤${targets.cvMax}%:  ${tirTarget(tir.cv, targets.cvMax, "lte")}`);
  console.log(`  GMI  <${targets.gmiMax}%:   ${tirTarget(tir.gmi, targets.gmiMax, "lt")}`);
}

// ── Program ──────────────────────────────────────────────────────

const program = new Command();
program
  .name("glu")
  .description("FreeStyle Libre 3 CGM data CLI — glucose, TIR, and configurable targets")
  .version("0.4.1")
  .addHelpText("after", `
OVERVIEW
  Reads glucose data from a FreeStyle Libre sensor via the LibreLinkUp API.
  Requires the LibreLinkUp app to be set up with sharing enabled.
  Credentials are stored in macOS Keychain (service: glu).

COMMAND CATEGORIES
  Auth:
    setup <email>        Save LibreLinkUp credentials (password prompted)
    login                Authenticate + discover patient
    status               Check connection status

  Data:
    current              Current glucose + trend arrow
    graph                Last 12h readings (table)
    logbook              Last ~2 weeks (table)
    tir [source]         TIR/TBR/TAR/CV/SD/GMI analysis (graph or logbook)
    overview             Current + 12h TIR summary

  Raw:
    json <path>          Raw JSON from any LibreLinkUp endpoint

GLUCOSE RANGES (mg/dL)
    <54     Very low   — Severe hypoglycemia, immediate treatment
    54–69   Low        — Hypoglycemia
    70–180  In range   — Target window
    181–250 High       — Hyperglycemia
    >250    Very high  — Severe hyperglycemia

TARGETS (2019 consensus defaults — override in ~/.config/glu/targets.json)
    TIR  ≥70%  Time in range (70–180 mg/dL)
    TBR  <4%   Time below range (<70 mg/dL)
    <54  <1%   Time in level-2 hypoglycemia
    TAR  <25%  Time above range (>180 mg/dL)
    >250 <5%   Time in level-2 hyperglycemia
    CV   ≤36%  Coefficient of variation (glucose stability)
    GMI  <7%   Glucose Management Indicator (estimated A1C)
    Run 'glu targets' to see effective values and the config path.

TREND ARROWS
    ↓↓ falling fast   ↓ falling   → stable   ↑ rising   ↑↑ rising fast

EXAMPLES
  glu setup user@example.com           Save credentials (password prompted)
  glu login                            Authenticate + discover patient
  glu current                          What's my glucose right now?
  glu graph                            Last 12h table
  glu tir                              TIR analysis on last 12h
  glu tir logbook                      TIR analysis on ~2 weeks
  glu json /llu/connections            Raw API response`);

// ── Auth commands ────────────────────────────────────────────────

program
  .command("setup <email>")
  .description("Save LibreLinkUp credentials (password prompted securely; stored in macOS Keychain)")
  .action(async (email: string) => {
    const password = await readSecret("LibreLinkUp password: ");
    if (!password) {
      out.error("No password provided.");
      process.exit(1);
    }
    await setSecret("email", email);
    await setSecret("password", password);
    out.success("Credentials saved to Keychain.");
    out.info("Now run: glu login");
  });

program
  .command("login")
  .description("Authenticate + discover patient")
  .action(async () => {
    await login();
  });

program
  .command("status")
  .description("Check connection status")
  .action(async () => {
    if (!(await hasSecret("token"))) {
      out.info("Not logged in. Run: glu login");
      return;
    }

    const url = (await getSecret("api-url")) ?? "unknown";
    const patient = (await getSecret("patient-name")) ?? "unknown";
    const expiresStr = await getSecret("token-expires");
    const expires = expiresStr ? parseInt(expiresStr, 10) : 0;
    const now = Math.floor(Date.now() / 1000);

    console.log(`API:     ${url}`);
    console.log(`Patient: ${patient}`);

    if (now >= expires) {
      console.log("Token:   expired (will auto-refresh on next call)");
    } else {
      const days = Math.floor((expires - now) / 86400);
      console.log(`Token:   valid (${days} days remaining)`);
    }
    out.info("Credentials: macOS Keychain (service: glu)");
  });

program
  .command("targets")
  .description("Show effective glycemic targets and where to override them")
  .addHelpText("after", `
Details:
  Targets default to the 2019 International Consensus on Time in Range.
  Override any subset by creating ~/.config/glu/targets.json, e.g.:

    {
      "tirMin": 80,
      "cvMax": 33,
      "gmiMax": 6.8
    }

  Keys: tirMin, tbrMax, tbrVeryLowMax, tarMax, tarVeryHighMax, cvMax, gmiMax.
  Only the keys you set are overridden; the rest stay at the consensus value.`)
  .action(() => {
    const targets = loadTargets();
    const overridden = new Set(overriddenKeys(targets));
    const tag = (k: keyof Targets) => (overridden.has(k) ? "  (override)" : "");
    out.heading("Glycemic targets");
    out.blank();
    console.log(`  TIR  ≥ ${targets.tirMin}%${tag("tirMin")}`);
    console.log(`  TBR  < ${targets.tbrMax}%${tag("tbrMax")}`);
    console.log(`  <54  < ${targets.tbrVeryLowMax}%${tag("tbrVeryLowMax")}`);
    console.log(`  TAR  < ${targets.tarMax}%${tag("tarMax")}`);
    console.log(`  >250 < ${targets.tarVeryHighMax}%${tag("tarVeryHighMax")}`);
    console.log(`  CV   ≤ ${targets.cvMax}%${tag("cvMax")}`);
    console.log(`  GMI  < ${targets.gmiMax}%${tag("gmiMax")}`);
    out.blank();
    out.info(overridden.size ? `${overridden.size} override(s) active.` : "All values at 2019 consensus defaults.");
    out.info(`Override file: ${getModuleConfigPath("targets")}`);
  });

// ── Data commands ────────────────────────────────────────────────

program
  .command("current")
  .description("Current glucose + trend arrow")
  .action(async () => {
    const r = await provider.current();
    console.log(`${r.mgPerDl} mg/dL (${r.mmolPerL} mmol/L) ${r.trendArrow ?? ""}  [${r.rangeLabel}]`);
    console.log(`  at ${r.timestamp}`);
  });

program
  .command("graph")
  .description("Last 12h readings (table)")
  .action(async () => {
    const { current, readings } = await provider.graph();

    if (current) {
      console.log(`Current: ${current.mgPerDl} mg/dL (${current.mmolPerL} mmol/L) ${current.trendArrow ?? ""}  at ${current.timestamp}`);
      out.blank();
    }

    out.info(`Last 12h — ${readings.length} readings`);
    out.blank();

    if (readings.length === 0) {
      out.info("No graph data.");
      return;
    }

    out.table(
      ["Time", "mg/dL", "mmol/L", "Range"],
      readings.map((r) => [
        r.timestamp,
        String(r.mgPerDl),
        String(r.mmolPerL),
        r.rangeLabel === "IN RANGE" ? "ok" : r.rangeLabel,
      ]),
    );
  });

program
  .command("logbook")
  .description("Last ~2 weeks (table)")
  .action(async () => {
    const readings = await provider.logbook();
    out.info(`Logbook — ${readings.length} entries`);
    out.blank();

    if (readings.length === 0) {
      out.info("No logbook data.");
      return;
    }

    out.table(
      ["Timestamp", "mg/dL", "mmol/L", "Range"],
      readings.map((r) => [
        r.timestamp,
        String(r.mgPerDl),
        String(r.mmolPerL),
        r.rangeLabel === "IN RANGE" ? "ok" : r.rangeLabel,
      ]),
    );
  });

program
  .command("tir [source]")
  .description("TIR/TBR/TAR/CV/SD/GMI analysis (source: graph or logbook, default: graph)")
  .action(async (source?: string) => {
    const src = (source ?? "graph") as "graph" | "logbook";
    if (src !== "graph" && src !== "logbook") {
      out.error("Usage: tir [graph|logbook] (default: graph)");
      process.exit(1);
    }

    const tir = await provider.tir(src);
    out.heading(`TIR Analysis — ${tir.source}`);
    out.blank();

    if (tir.readings === 0) {
      out.info("No readings available.");
      return;
    }

    printTir(tir);
  });

program
  .command("overview")
  .description("Current + 12h TIR summary")
  .action(async () => {
    out.heading("Glu Overview");
    out.blank();

    // Use graph endpoint — gives both current + 12h data in one call
    const { current, readings } = await provider.graph();

    out.subheading("Current");
    if (current) {
      console.log(`  ${current.mgPerDl} mg/dL (${current.mmolPerL} mmol/L) ${current.trendArrow ?? ""}  [${current.rangeLabel}]  at ${current.timestamp}`);
    } else {
      out.info("  No current reading.");
    }
    out.blank();

    out.subheading("TIR (12h)");
    if (readings.length === 0) {
      out.info("  No data.");
      return;
    }

    const values = readings.map((r) => r.mgPerDl);
    const n = values.length;
    const preciseMean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - preciseMean) ** 2, 0) / n;
    const sd = Math.round(Math.sqrt(variance) * 10) / 10;
    const cv = Math.round((sd / preciseMean) * 1000) / 10;
    const gmi = Math.round(((preciseMean + 46.7) / 28.7) * 10) / 10;
    const mean = Math.round(preciseMean);

    const below = values.filter((v) => v < 70).length;
    const inRange = values.filter((v) => v >= 70 && v <= 180).length;
    const above = values.filter((v) => v > 180).length;

    const pct = (c: number) => Math.round(c * 1000 / n) / 10;

    console.log(`  Readings: ${n} | Mean: ${mean} mg/dL | SD: ${sd} | CV: ${cv}%`);
    console.log(`  TIR: ${pct(inRange)}%${pct(inRange) >= 80 ? " ✓" : ""} | TBR: ${pct(below)}%${pct(below) < 5 ? " ✓" : ""} | TAR: ${pct(above)}%`);
    console.log(`  GMI: ${gmi}% | Range: ${Math.min(...values)}–${Math.max(...values)} mg/dL`);
  });

program
  .command("json <path>")
  .description("Raw JSON from any endpoint (e.g. /llu/connections)")
  .action(async (path: string) => {
    out.json(await provider.json(path));
  });

// ── Run ──────────────────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (e: unknown) {
  out.error((e as Error).message);
  process.exit(1);
}
