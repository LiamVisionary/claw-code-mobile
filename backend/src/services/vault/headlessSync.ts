import { execSync, execFileSync, spawn, ChildProcess } from "child_process";
import fs from "fs";
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

/** Build an env object that puts Node 22+ first on PATH so `ob` uses it. */
function obEnv(): Record<string, string> {
  const node22 = node22Bin();
  const env = { ...process.env } as Record<string, string>;
  if (node22) {
    env.PATH = `${node22}:${env.PATH ?? ""}`;
  }
  return env;
}

/** Run an `ob` command synchronously with the correct Node version. */
function obExec(
  args: string,
  opts: { timeout?: number; stdio?: any } = {}
): string {
  const bin = obBin();
  return execSync(`${bin} ${args}`, {
    encoding: "utf8",
    timeout: opts.timeout ?? 15_000,
    env: obEnv(),
    ...(opts.stdio ? { stdio: opts.stdio } : {}),
  });
}

function obBin(): string {
  // obsidian-headless requires Node 22+. Find the ob binary, preferring
  // Node 22+ installations over whatever the current process uses.
  const candidates = [
    // Explicit Node 22 nvm path
    path.join(os.homedir(), ".nvm/versions/node", "v22.22.2", "bin/ob"),
    // Generic: scan nvm for any Node >=22
    ...(() => {
      try {
        const nvmDir = path.join(os.homedir(), ".nvm/versions/node");
        const dirs = fs.readdirSync(nvmDir).filter((d: string) => {
          const m = d.match(/^v(\d+)\./);
          return m && parseInt(m[1], 10) >= 22;
        }).sort().reverse();
        return dirs.map((d: string) => path.join(nvmDir, d, "bin/ob"));
      } catch { return []; }
    })(),
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch { /* not found */ }
  }
  // Fall back to PATH
  try {
    return execSync("which ob", { encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    return "ob";
  }
}

/** Check if obsidian-headless is installed. */
export function isInstalled(): boolean {
  try {
    const bin = obBin();
    execSync(`${bin} --help`, { stdio: "ignore", timeout: 5_000, env: obEnv() });
    return true;
  } catch {
    // ob --help may exit non-zero; check if the binary exists at all
    try {
      fs.accessSync(obBin(), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/** Find a Node 22+ binary for obsidian-headless. */
function node22Bin(): string | null {
  try {
    const nvmDir = path.join(os.homedir(), ".nvm/versions/node");
    const dirs = fs.readdirSync(nvmDir).filter((d: string) => {
      const m = d.match(/^v(\d+)\./);
      return m && parseInt(m[1], 10) >= 22;
    }).sort().reverse();
    if (dirs.length > 0) {
      return path.join(nvmDir, dirs[0], "bin");
    }
  } catch { /* nvm not present */ }
  // Check if current node is 22+
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 22) return path.dirname(process.execPath);
  return null;
}

/** Install obsidian-headless globally via npm. */
export async function install(): Promise<{ ok: boolean; message: string }> {
  try {
    // First ensure Node 22 is available
    let node22 = node22Bin();
    if (!node22) {
      // Try to install Node 22 via nvm
      try {
        execSync(
          'bash -c "source ~/.nvm/nvm.sh && nvm install 22"',
          { encoding: "utf8", timeout: 120_000 }
        );
        node22 = node22Bin();
      } catch {
        return {
          ok: false,
          message: "obsidian-headless requires Node.js 22+. Install it with: nvm install 22",
        };
      }
    }
    if (!node22) {
      return {
        ok: false,
        message: "Could not find Node.js 22+. Install it with: nvm install 22",
      };
    }
    // Install obsidian-headless using Node 22's npm
    const npmBin = path.join(node22, "npm");
    execSync(`${npmBin} install -g obsidian-headless`, {
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, PATH: `${node22}:${process.env.PATH}` },
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
    // Use sync-list-remote as a login probe — it fails fast if not logged in
    // and doesn't prompt for credentials like `ob login` does.
    const out = obExec("sync-list-remote", { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    // If we get output (even empty list), we're logged in
    return "logged-in";
  } catch (err: any) {
    const msg = (err?.stderr || err?.stdout || "").toString();
    if (msg.includes("not logged in") || msg.includes("login")) return null;
    // Other error — might still be logged in but hit a network issue
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
    // Use execFileSync with args array to avoid shell interpretation
    // of special characters in email/password.
    const args = [`login`, `--email`, email, `--password`, password];
    if (mfa) args.push(`--mfa`, mfa);
    const out = execFileSync(obBin(), args, {
      encoding: "utf8",
      timeout: 30_000,
      env: obEnv(),
    });
    return { ok: true, message: out.trim() || "Logged in" };
  } catch (err: any) {
    // ob dumps stack traces and raw Error objects to stderr — never show those.
    const raw = err?.stderr?.trim() || err?.stdout?.trim() || err?.message || "";
    if (raw.toLowerCase().includes("2fa") || raw.toLowerCase().includes("mfa"))
      return { ok: false, message: "2FA code required or incorrect." };
    if (raw.toLowerCase().includes("login failed") || raw.toLowerCase().includes("email and password"))
      return { ok: false, message: "Incorrect email or password." };
    return { ok: false, message: "Login failed. Check your credentials." };
  }
}

/** Log out of Obsidian account. */
export function logout(): { ok: boolean; message: string } {
  try {
    obExec("logout", { timeout: 10_000 });
    return { ok: true, message: "Logged out" };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Logout failed" };
  }
}

/** List remote vaults available to the logged-in account. */
export function listRemoteVaults(): RemoteVault[] {
  try {
    const out = obExec("sync-list-remote", { timeout: 15_000 });
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
      vaultIdOrName,
      `--path`,
      resolved,
    ];
    if (password) args.push(`--password`, password);
    if (deviceName) args.push(`--device-name`, deviceName);
    else args.push(`--device-name`, `claw-code-mobile`);

    const out = execFileSync(obBin(), args, {
      encoding: "utf8",
      timeout: 30_000,
      env: obEnv(),
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
    const out = obExec(`sync --path "${resolved}"`, { timeout: 120_000 });
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
      env: obEnv(),
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
    const out = obExec("sync-list-local", { timeout: 10_000 });
    if (out.trim() && !out.includes("No ")) {
      const firstLine = out.trim().split("\n")[0];
      return { state: "idle", vault: firstLine, path: "" };
    }
  } catch {
    // ignore
  }

  return { state: "no_vault" };
}
