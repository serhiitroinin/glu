#!/usr/bin/env bun
import { Command } from "commander";
import { setSecret, getSecret, hasSecret } from "./lib/keychain.ts";
import { importFromLuff } from "./lib/import-luff.ts";
import * as out from "./lib/output.ts";
import { libreProvider, login } from "./providers/libre.ts";
import type { GlucoseProvider, TirAnalysis } from "./types.ts";

const provider: GlucoseProvider = libreProvider;

// ── Formatting helpers ───────────────────────────────────────────

function tirCheck(value: number, target: number, op: "gte" | "lt"): string {
  if (op === "gte") return value >= target ? " ✓" : "";
  return value < target ? " ✓" : "";
}

function tirTarget(value: number, target: number, op: "gte" | "lt"): string {
  const pass = op === "gte" ? value >= target : value < target;
  return pass ? `✓ PASS` : `✗ MISS (${value}%)`;
}

function printTir(tir: TirAnalysis): void {
  out.info(`Readings:  ${tir.readings}`);
  out.blank();

  console.log("── Glucose ──────────────────────────");
  console.log(`  Mean:    ${tir.mean} mg/dL (${tir.meanMmol} mmol/L)`);
  console.log(`  SD:      ${tir.sd} mg/dL`);
  console.log(`  CV:      ${tir.cv}%${tir.cv < 33 ? " ✓" : tir.cv < 36 ? " ⚠" : " ✗"}`);
  console.log(`  Min:     ${tir.min} mg/dL  Max: ${tir.max} mg/dL`);
  console.log(`  GMI:     ${tir.gmi}%`);
  out.blank();

  console.log("── Time in Range ────────────────────");
  console.log(`  Very Low  (<54):     ${tir.veryLowPct}%  (${tir.veryLow}/${tir.readings})${tir.veryLow === 0 ? " ✓" : " ✗"}`);
  console.log(`  Low       (54-69):   ${tir.lowPct}%  (${tir.low}/${tir.readings})`);
  console.log(`  TBR total (<70):     ${tir.tbrPct}%${tirCheck(tir.tbrPct, 5, "lt")}`);
  console.log(`  In Range  (70-180):  ${tir.tirPct}%  (${tir.inRange}/${tir.readings})${tir.tirPct >= 80 ? " ✓" : tir.tirPct >= 70 ? " ⚠" : " ✗"}`);
  console.log(`  High      (181-250): ${tir.highPct}%  (${tir.high}/${tir.readings})`);
  console.log(`  Very High (>250):    ${tir.veryHighPct}%  (${tir.veryHigh}/${tir.readings})`);
  out.blank();

  console.log("── Targets (consensus 2019) ─────────");
  console.log(`  TIR ≥80%:  ${tirTarget(tir.tirPct, 80, "gte")}`);
  console.log(`  TBR <5%:   ${tirTarget(tir.tbrPct, 5, "lt")}`);
  console.log(`  CV <33%:   ${tirTarget(tir.cv, 33, "lt")}`);
  console.log(`  GMI <6.8%: ${tirTarget(tir.gmi, 6.8, "lt")}`);
}

// ── Program ──────────────────────────────────────────────────────

const program = new Command();
program
  .name("glu")
  .description("FreeStyle Libre 3 CGM data CLI — glucose, TIR, and clinical targets")
  .version("0.1.0")
  .addHelpText("after", `
OVERVIEW
  Reads glucose data from a FreeStyle Libre sensor via the LibreLinkUp API.
  Requires the LibreLinkUp app to be set up with sharing enabled.
  Credentials are stored in macOS Keychain (service: glu).

COMMAND CATEGORIES
  Auth:
    setup <email> <pw>   Save LibreLinkUp credentials
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

CLINICAL TARGETS (consensus 2019, adults non-pregnant)
    TIR ≥80%  Time in range (70–180 mg/dL)
    TBR <5%   Time below range (<70 mg/dL)
    TAR <25%  Time above range (>180 mg/dL)
    CV  <33%  Coefficient of variation (glucose stability)
    GMI <6.8% Glucose Management Indicator (estimated A1C)

TREND ARROWS
    ↓↓ falling fast   ↓ falling   → stable   ↑ rising   ↑↑ rising fast

EXAMPLES
  glu setup user@example.com mypass    Save credentials
  glu login                            Authenticate + discover patient
  glu current                          What's my glucose right now?
  glu graph                            Last 12h table
  glu tir                              TIR analysis on last 12h
  glu tir logbook                      TIR analysis on ~2 weeks
  glu json /llu/connections            Raw API response`);

// ── Auth commands ────────────────────────────────────────────────

program
  .command("setup <email> <password>")
  .description("Save LibreLinkUp credentials (stored in macOS Keychain)")
  .action(async (email: string, password: string) => {
    setSecret("email", email);
    setSecret("password", password);
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
  .action(() => {
    if (!hasSecret("token")) {
      out.info("Not logged in. Run: glu login");
      return;
    }

    const url = getSecret("api-url") ?? "unknown";
    const patient = getSecret("patient-name") ?? "unknown";
    const expiresStr = getSecret("token-expires");
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
  .command("auth-import-from-luff")
  .description("One-shot: copy LibreLinkUp auth from legacy luff-libre Keychain entry")
  .addHelpText("after", `
Details:
  For users migrating from the older 'libre' CLI shipped via the luff
  monorepo. Reads all credentials stored under the 'luff-libre' Keychain
  service and copies them to 'glu'. Idempotent — re-run is safe.

  The source entries are NOT deleted; remove them manually with:
    security delete-generic-password -s luff-libre -a <account>

Example:
  glu auth-import-from-luff`)
  .action(() => {
    const { copied, missing } = importFromLuff();
    if (copied.length === 0) {
      out.error("No entries found under luff-libre. Nothing to import.");
      process.exit(1);
    }
    out.success(`Imported ${copied.length} entries from luff-libre:`);
    for (const k of copied) console.log(`  + ${k}`);
    if (missing.length > 0) {
      out.blank();
      out.info(`Missing (not present in luff-libre): ${missing.join(", ")}`);
    }
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
