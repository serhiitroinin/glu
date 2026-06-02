import { createHash } from "node:crypto";
import { getSecret, setSecret, requireSecret } from "../lib/keychain.ts";
import { computeTir, mgToMmol } from "../analysis.ts";
import type {
  GlucoseProvider,
  GlucoseReading,
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

async function apiUrl(): Promise<string> {
  return (await getSecret("api-url")) ?? DEFAULT_API_URL;
}

async function isTokenValid(): Promise<boolean> {
  const expires = await getSecret("token-expires");
  if (!expires) return false;
  return Date.now() / 1000 < parseInt(expires, 10);
}

async function login(quiet = false): Promise<void> {
  const email = await requireSecret("email");
  const password = await requireSecret("password");
  let url = await apiUrl();

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
    await setSecret("api-url", url);
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
  await setSecret("token", token);
  await setSecret("token-expires", String(expires));
  await setSecret("patient-id", patient.patientId);
  await setSecret("patient-name", `${patient.firstName} ${patient.lastName}`);
  await setSecret("account-hash", accountHash);
  await setSecret("api-url", url);

  if (!quiet) {
    console.log(`Login successful! Connected to: ${patient.firstName} ${patient.lastName}`);
  }
}

async function ensureAuth(): Promise<void> {
  if (!(await isTokenValid())) {
    await login(true);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  await ensureAuth();
  const token = await requireSecret("token");
  const accountHash = await requireSecret("account-hash");
  const url = await apiUrl();

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


function mapReading(r: RawGlucoseMeasurement): GlucoseReading {
  return {
    timestamp: r.Timestamp,
    mgPerDl: r.ValueInMgPerDl,
    mmolPerL: mgToMmol(r.ValueInMgPerDl),
    trendArrow: r.TrendArrow ? trendArrow(r.TrendArrow) : null,
    rangeLabel: rangeLabel(r.ValueInMgPerDl),
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
    const patientId = await requireSecret("patient-id");
    const body = await apiGet<RawGraphResponse>(`/llu/connections/${patientId}/graph`);

    const currentRaw = body.data?.connection?.glucoseMeasurement;
    const current = currentRaw ? mapReading(currentRaw) : null;
    const readings = (body.data?.graphData ?? [])
      .filter((r) => r.ValueInMgPerDl != null)
      .map(mapReading);

    return { current, readings };
  },

  async logbook() {
    const patientId = await requireSecret("patient-id");
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
