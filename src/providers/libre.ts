import { createHash } from "node:crypto";
import { getSecret, setSecret, requireSecret } from "../lib/keychain.ts";
import type {
  GlucoseProvider,
  GlucoseReading,
  TirAnalysis,
  TrendArrow,
  RangeLabel,
} from "../types.ts";

const DEFAULT_API_URL = "https://api-eu.libreview.io";

const LLU_HEADERS: Record<string, string> = {
  "product": "llu.android",
  "version": "4.16.0",
  "content-type": "application/json",
  "cache-control": "no-cache",
  "connection": "Keep-Alive",
};

// ── Raw API types ────────────────────────────────────────────────

interface RawLoginResponse {
  status: number;
  data: {
    redirect?: boolean;
    region?: string;
    authTicket?: {
      token: string;
      expires: number;
      duration: number;
    };
    user?: { id: string };
  };
  error?: { message?: string };
}

interface RawGlucoseMeasurement {
  ValueInMgPerDl: number;
  TrendArrow: number;
  Timestamp: string;
}

interface RawConnection {
  patientId: string;
  firstName: string;
  lastName: string;
  glucoseMeasurement: RawGlucoseMeasurement | null;
}

interface RawGraphResponse {
  data: {
    connection: {
      glucoseMeasurement: RawGlucoseMeasurement | null;
    };
    graphData: RawGlucoseMeasurement[];
  };
}

// ── Auth helpers ─────────────────────────────────────────────────

function apiUrl(): string {
  return getSecret("api-url") ?? DEFAULT_API_URL;
}

function isTokenValid(): boolean {
  const expires = getSecret("token-expires");
  if (!expires) return false;
  return Date.now() / 1000 < parseInt(expires, 10);
}

async function login(quiet = false): Promise<void> {
  const email = requireSecret("email");
  const password = requireSecret("password");
  let url = apiUrl();

  // Login request
  let res = await fetch(`${url}/llu/auth/login`, {
    method: "POST",
    headers: LLU_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  let body = await res.json() as RawLoginResponse;

  // Handle region redirect
  if (body.data?.redirect && body.data.region) {
    const region = body.data.region;
    if (!/^[a-z]{2}$/.test(region)) {
      throw new Error(`Invalid region code from API: ${region}`);
    }
    url = `https://api-${region}.libreview.io`;
    setSecret("api-url", url);
    if (!quiet) console.log(`Redirecting to region: ${body.data.region}`);

    res = await fetch(`${url}/llu/auth/login`, {
      method: "POST",
      headers: LLU_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    body = await res.json() as RawLoginResponse;
  }

  // Check status
  switch (body.status) {
    case 0: break; // success
    case 2: throw new Error("Login failed: bad credentials");
    case 4: throw new Error("Login failed: accept Terms of Use in the LibreLinkUp app first");
    default:
      throw new Error(`Login failed: ${body.error?.message ?? `unknown error (status: ${body.status})`}`);
  }

  const token = body.data?.authTicket?.token;
  if (!token) throw new Error("Login failed: no token in response");

  const expires = body.data.authTicket!.expires;
  const userId = body.data.user?.id;
  if (!userId) throw new Error("Login failed: no user ID in response");

  const accountHash = createHash("sha256").update(userId).digest("hex");

  // Discover patient from connections
  const connRes = await fetch(`${url}/llu/connections`, {
    headers: {
      ...LLU_HEADERS,
      "Authorization": `Bearer ${token}`,
      "Account-Id": accountHash,
    },
  });
  const connBody = await connRes.json() as { data: RawConnection[] };

  const patient = connBody.data?.[0];
  if (!patient?.patientId) {
    throw new Error("No connected patients found. Set up sharing in the LibreLinkUp app first.");
  }

  // Save all session data to Keychain
  setSecret("token", token);
  setSecret("token-expires", String(expires));
  setSecret("patient-id", patient.patientId);
  setSecret("patient-name", `${patient.firstName} ${patient.lastName}`);
  setSecret("account-hash", accountHash);
  setSecret("api-url", url);

  if (!quiet) {
    console.log(`Login successful! Connected to: ${patient.firstName} ${patient.lastName}`);
  }
}

async function ensureAuth(): Promise<void> {
  if (!isTokenValid()) {
    await login(true);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  await ensureAuth();
  const token = requireSecret("token");
  const accountHash = requireSecret("account-hash");
  const url = apiUrl();

  const res = await fetch(`${url}${path}`, {
    headers: {
      ...LLU_HEADERS,
      "Authorization": `Bearer ${token}`,
      "Account-Id": accountHash,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} GET ${path}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

// ── Mappers ──────────────────────────────────────────────────────

function trendArrow(code: number): TrendArrow {
  switch (code) {
    case 1: return "↓↓";
    case 2: return "↓";
    case 3: return "→";
    case 4: return "↑";
    case 5: return "↑↑";
    default: return "?";
  }
}

function rangeLabel(mg: number): RangeLabel {
  if (mg < 54) return "VERY LOW";
  if (mg < 70) return "LOW";
  if (mg <= 180) return "IN RANGE";
  if (mg <= 250) return "HIGH";
  return "VERY HIGH";
}

function mgToMmol(mg: number): number {
  return Math.round(mg / 18.0 * 10) / 10;
}

function mapReading(r: RawGlucoseMeasurement): GlucoseReading {
  return {
    timestamp: r.Timestamp,
    mgPerDl: r.ValueInMgPerDl,
    mmolPerL: mgToMmol(r.ValueInMgPerDl),
    trendArrow: r.TrendArrow ? trendArrow(r.TrendArrow) : null,
    rangeLabel: rangeLabel(r.ValueInMgPerDl),
  };
}

function computeTir(readings: GlucoseReading[], source: string): TirAnalysis {
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

// ── Provider ─────────────────────────────────────────────────────

export const libreProvider: GlucoseProvider = {
  name: "libre",

  async current() {
    const body = await apiGet<{ data: RawConnection[] }>("/llu/connections");
    const measurement = body.data?.[0]?.glucoseMeasurement;
    if (!measurement) throw new Error("No current reading available.");
    return mapReading(measurement);
  },

  async graph() {
    const patientId = requireSecret("patient-id");
    const body = await apiGet<RawGraphResponse>(`/llu/connections/${patientId}/graph`);

    const currentRaw = body.data?.connection?.glucoseMeasurement;
    const current = currentRaw ? mapReading(currentRaw) : null;
    const readings = (body.data?.graphData ?? [])
      .filter((r) => r.ValueInMgPerDl != null)
      .map(mapReading);

    return { current, readings };
  },

  async logbook() {
    const patientId = requireSecret("patient-id");
    const body = await apiGet<{ data: RawGlucoseMeasurement[] }>(`/llu/connections/${patientId}/logbook`);
    return (body.data ?? [])
      .filter((r) => r.ValueInMgPerDl != null)
      .map(mapReading);
  },

  async tir(source) {
    if (source === "graph") {
      const { readings } = await this.graph();
      return computeTir(readings, "Last 12 hours (graph)");
    }
    const readings = await this.logbook();
    return computeTir(readings, "Logbook (~2 weeks)");
  },

  async json(path) {
    return apiGet(path);
  },
};

export { login };
