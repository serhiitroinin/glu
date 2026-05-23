import { execFileSync } from "node:child_process";
import { setSecret } from "./keychain.ts";

const LUFF_SERVICE = "luff-libre";

// Account names glu expects to find in the luff-libre keychain entry.
const ACCOUNTS = [
  "email",
  "password",
  "api-url",
  "token",
  "token-expires",
  "patient-id",
  "patient-name",
  "account-hash",
];

function readLuffSecret(account: string): string | null {
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", LUFF_SERVICE, "-a", account, "-w"],
      { stdio: "pipe", encoding: "utf-8" },
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

export interface ImportSummary {
  copied: string[];
  missing: string[];
}

export function importFromLuff(): ImportSummary {
  const copied: string[] = [];
  const missing: string[] = [];
  for (const account of ACCOUNTS) {
    const value = readLuffSecret(account);
    if (value == null) {
      missing.push(account);
      continue;
    }
    setSecret(account, value);
    copied.push(account);
  }
  return { copied, missing };
}
