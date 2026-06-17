import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Secret storage. On macOS, access goes through the Apple-signed `/usr/bin/security`
// tool: because that reader has a stable code signature, macOS's "Always Allow"
// persists — unlike an ad-hoc-signed compiled binary, which would re-prompt on every
// run. On other platforms (Linux servers) there's no `security` binary, so we fall
// back to a 0600 JSON file under $XDG_CONFIG_HOME (override with GLU_SECRETS_FILE).
const run = promisify(execFile);
const SERVICE = "glu";
const useKeychain = process.platform === "darwin";

function storePath(): string {
  return (
    process.env.GLU_SECRETS_FILE ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), SERVICE, "secrets.json")
  );
}
function readStore(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(storePath(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}
function writeStore(store: Record<string, string>): void {
  const p = storePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {}
}

export async function setSecret(account: string, value: string): Promise<void> {
  if (!useKeychain) {
    const store = readStore();
    store[account] = value;
    writeStore(store);
    return;
  }
  // Recreate the item so its ACL trusts /usr/bin/security, keeping reads prompt-free.
  try { await run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]); } catch {}
  await run("security", ["add-generic-password", "-s", SERVICE, "-a", account, "-w", value]);
}

export async function getSecret(account: string): Promise<string | null> {
  if (!useKeychain) return readStore()[account] ?? null;
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    return stdout.replace(/\n$/, "") || null;
  } catch {
    return null;
  }
}

export async function requireSecret(account: string): Promise<string> {
  const value = await getSecret(account);
  if (value === null) {
    throw new Error(`No secret found in Keychain for account "${account}". Run: ${SERVICE} setup`);
  }
  return value;
}

export async function deleteSecret(account: string): Promise<boolean> {
  if (!useKeychain) {
    const store = readStore();
    if (!(account in store)) return false;
    delete store[account];
    writeStore(store);
    return true;
  }
  try {
    await run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    return true;
  } catch {
    return false;
  }
}

export async function hasSecret(account: string): Promise<boolean> {
  return (await getSecret(account)) !== null;
}
