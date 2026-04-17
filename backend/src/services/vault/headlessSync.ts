import { execSync, spawn, ChildProcess } from "child_process";
import path from "path";
import os from "os";

/** Status of the headless sync daemon. */
export type SyncStatus =
  | { state: "not_installed" }
  | { state: "not_logged_in" }
  | { state: "no_vault" }
  | { state: "idle"; vault: string; path: string }
  | { state: "syncing"; vault: string; path: string; pid: number }
  | { state: "error"; message: string };

export type RemoteVault = {
  id: string;
  name: string;
  encryption: string;
};

let syncProcess: ChildProcess | null = null;
let syncVaultName: string | null = null;
let syncVaultPath: string | null = null;

function obBin(): string {
  // Prefer local npx, fall back to global
  try {
    return execSync("which ob", { encoding: "utf8" }).trim();
  } catch {
    return "ob";
  }
}

/** Check if obsidian-headless is installed. */
export function isInstalled(): boolean {
  try {
    execSync("ob --help", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Install obsidian-headless globally via npm. */
export async function install(): Promise<{ ok: boolean; message: string }> {
  try {
    execSync("npm install -g obsidian-headless", {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { ok: true, message: "obsidian-headless installed" };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.stderr || err?.message || "Installation failed",
    };
  }
}

/** Check login status. Returns the logged-in email or null. */
export function getLoginStatus(): string | null {
  try {
    const out = execSync(`${obBin()} login`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    // ob login shows account info if already logged in
    const match = out.match(/logged in as (.+)/i) || out.match(/email:\s*(.+)/i);
    return match?.[1]?.trim() ?? (out.includes("@") ? out.trim() : null);
  } catch {
    return null;
  }
}

/** Log in to Obsidian account. */
export async function login(
  email: string,
  password: string,
  mfa?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const args = [`login`, `--email`, email, `--password`, password];
    if (mfa) args.push(`--mfa`, mfa);
    const out = execSync(`${obBin()} ${args.join(" ")}`, {
      encoding: "utf8",
      timeout: 30_000,
    });
    return { ok: true, message: out.trim() || "Logged in" };
  } catch (err: any) {
    const msg =
      err?.stderr?.trim() || err?.stdout?.trim() || err?.message || "Login failed";
    return { ok: false, message: msg };
  }
}

/** Log out of Obsidian account. */
export function logout(): { ok: boolean; message: string } {
  try {
    execSync(`${obBin()} logout`, { encoding: "utf8", timeout: 10_000 });
    return { ok: true, message: "Logged out" };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Logout failed" };
  }
}

/** List remote vaults available to the logged-in account. */
export function listRemoteVaults(): RemoteVault[] {
  try {
    const out = execSync(`${obBin()} sync-list-remote`, {
      encoding: "utf8",
      timeout: 15_000,
    });
    // Parse output — each line typically has vault info
    const vaults: RemoteVault[] = [];
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("No ")) continue;
      // Try to parse structured output; format varies
      // Common: "id: abc123  name: My Vault  encryption: e2ee"
      // Or just: "My Vault (abc123) - e2ee"
      const idMatch = trimmed.match(/id:\s*(\S+)/i);
      const nameMatch = trimmed.match(/name:\s*(.+?)(?:\s{2,}|$)/i);
      if (idMatch && nameMatch) {
        vaults.push({
          id: idMatch[1],
          name: nameMatch[1].trim(),
          encryption: trimmed.match(/encryption:\s*(\S+)/i)?.[1] ?? "unknown",
        });
      } else {
        // Fallback: treat the whole line as a vault entry
        const parenMatch = trimmed.match(/^(.+?)\s*\((\S+)\)/);
        if (parenMatch) {
          vaults.push({
            id: parenMatch[2],
            name: parenMatch[1].trim(),
            encryption: trimmed.includes("e2ee") ? "e2ee" : "standard",
          });
        }
      }
    }
    // If parsing failed but we got output, return raw
    if (vaults.length === 0 && out.trim()) {
      // Return each non-empty line as a vault with name = line
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (t) vaults.push({ id: t, name: t, encryption: "unknown" });
      }
    }
    return vaults;
  } catch {
    return [];
  }
}

/** Set up sync between a local path and a remote vault. */
export async function setupSync(
  vaultIdOrName: string,
  localPath: string,
  password?: string,
  deviceName?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const resolved = path.resolve(localPath.replace(/^~/, os.homedir()));
    const args = [
      `sync-setup`,
      `--vault`,
      `"${vaultIdOrName}"`,
      `--path`,
      resolved,
    ];
    if (password) args.push(`--password`, password);
    if (deviceName) args.push(`--device-name`, deviceName);
    else args.push(`--device-name`, `claw-code-mobile`);

    const out = execSync(`${obBin()} ${args.join(" ")}`, {
      encoding: "utf8",
      timeout: 30_000,
    });
    return { ok: true, message: out.trim() || "Sync configured" };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.stderr?.trim() || err?.message || "Setup failed",
    };
  }
}

/** Run a one-time sync. */
export async function syncOnce(
  localPath: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const resolved = path.resolve(localPath.replace(/^~/, os.homedir()));
    const out = execSync(`${obBin()} sync --path "${resolved}"`, {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { ok: true, message: out.trim() || "Sync complete" };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.stderr?.trim() || err?.message || "Sync failed",
    };
  }
}

/** Start continuous sync as a background process. */
export function startContinuousSync(
  localPath: string
): { ok: boolean; message: string; pid?: number } {
  if (syncProcess && !syncProcess.killed) {
    return {
      ok: true,
      message: "Sync already running",
      pid: syncProcess.pid,
    };
  }
  try {
    const resolved = path.resolve(localPath.replace(/^~/, os.homedir()));
    syncProcess = spawn(obBin(), ["sync", "--continuous", "--path", resolved], {
      stdio: "ignore",
      detached: true,
    });
    syncProcess.unref();
    syncVaultPath = resolved;

    syncProcess.on("exit", () => {
      syncProcess = null;
      syncVaultPath = null;
      syncVaultName = null;
    });

    return {
      ok: true,
      message: "Continuous sync started",
      pid: syncProcess.pid,
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Failed to start sync" };
  }
}

/** Stop the continuous sync process. */
export function stopContinuousSync(): { ok: boolean; message: string } {
  if (!syncProcess || syncProcess.killed) {
    syncProcess = null;
    return { ok: true, message: "No sync process running" };
  }
  try {
    syncProcess.kill("SIGTERM");
    syncProcess = null;
    syncVaultPath = null;
    syncVaultName = null;
    return { ok: true, message: "Sync stopped" };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Failed to stop sync" };
  }
}

/** Get current sync status. */
export function getSyncStatus(): SyncStatus {
  if (!isInstalled()) return { state: "not_installed" };

  const email = getLoginStatus();
  if (!email) return { state: "not_logged_in" };

  if (syncProcess && !syncProcess.killed && syncVaultPath) {
    return {
      state: "syncing",
      vault: syncVaultName ?? "unknown",
      path: syncVaultPath,
      pid: syncProcess.pid!,
    };
  }

  // Check if there's a configured vault
  try {
    const out = execSync(`${obBin()} sync-list-local`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (out.trim() && !out.includes("No ")) {
      const firstLine = out.trim().split("\n")[0];
      return { state: "idle", vault: firstLine, path: "" };
    }
  } catch {
    // ignore
  }

  return { state: "no_vault" };
}
