#!/usr/bin/env node
// Cross-platform launcher for the Room Flythrough Studio.
// Called by "Start Studio.command" (macOS) and "Start Studio.bat" (Windows)
// so double-clicking an icon is enough -- no manual terminal commands needed.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import http from "node:http";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
process.chdir(rootDir);

const WEBAPP_URL = "http://localhost:5183";
const isWindows = process.platform === "win32";

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, bin))) return true;
  }
  return false;
}

/**
 * pnpm is this project's package manager (package.json -> packageManager).
 * Prefer a pnpm on PATH; otherwise fall back to Corepack, which ships with Node
 * and fetches the pinned pnpm on demand -- so double-clicking works even where
 * pnpm was never installed globally.
 */
function resolvePackageManager() {
  if (findOnPath(isWindows ? "pnpm.cmd" : "pnpm")) {
    return { cmd: isWindows ? "pnpm.cmd" : "pnpm", prefix: [] };
  }
  if (findOnPath(isWindows ? "corepack.cmd" : "corepack")) {
    return { cmd: isWindows ? "corepack.cmd" : "corepack", prefix: ["pnpm"] };
  }
  return null;
}

const pm = resolvePackageManager();

function openUrl(url) {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore" });
  } else if (isWindows) {
    // "start" is a cmd builtin; the empty "" first arg becomes the window title.
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", shell: false });
  } else {
    spawn("xdg-open", [url], { stdio: "ignore" });
  }
}

function waitForServer(url, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tryOnce = () => {
      const req = http.get(url, () => {
        req.destroy();
        resolve();
      });
      req.on("error", () => {
        req.destroy();
        if (Date.now() - startedAt > timeoutMs) reject(new Error("Timeout beim Warten auf den Server"));
        else setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

// Node >= 18.20 refuses to spawn .cmd/.bat directly, and both pnpm and corepack
// are .cmd shims on Windows. Going through cmd.exe explicitly (rather than
// `shell: true`) does the same thing without Node's DEP0190 warning, which
// would otherwise show up in the double-click window. Every argument we pass is
// a bare token, so there is nothing for cmd to mis-parse.
function spawnPm(args) {
  const argv = [...pm.prefix, ...args];
  return isWindows
    ? spawn("cmd.exe", ["/d", "/s", "/c", pm.cmd, ...argv], { cwd: rootDir, stdio: "inherit" })
    : spawn(pm.cmd, argv, { cwd: rootDir, stdio: "inherit" });
}

function runPm(args) {
  return new Promise((resolve, reject) => {
    const child = spawnPm(args);
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pnpm ${args.join(" ")} fehlgeschlagen (Code ${code})`)),
    );
  });
}

async function main() {
  console.log("========================================");
  console.log("  Room Flythrough Studio");
  console.log("========================================");
  console.log(`Verzeichnis: ${rootDir}\n`);

  if (!pm) {
    throw new Error(
      "Weder pnpm noch corepack gefunden. Installiere Node.js (LTS) von https://nodejs.org/ " +
        "-- corepack ist dort enthalten -- oder pnpm global via 'npm i -g pnpm'.",
    );
  }

  if (!existsSync(path.join(rootDir, "node_modules"))) {
    console.log("Erster Start: installiere Abhaengigkeiten (pnpm install)...");
    console.log("Das kann beim allerersten Mal ein paar Minuten dauern.\n");
    await runPm(["install"]);
  }

  console.log("\nStarte Server + Studio-Oberflaeche ...\n");
  const child = spawnPm(["run", "studio"]);

  waitForServer(WEBAPP_URL)
    .then(() => {
      console.log(`\nFertig! Oeffne ${WEBAPP_URL} im Browser ...`);
      openUrl(WEBAPP_URL);
    })
    .catch(() => {
      console.log(`\nDer Server braucht ungewoehnlich lange. Oeffne ${WEBAPP_URL} von Hand im Browser, sobald er bereit ist.`);
    });

  child.on("exit", (code) => {
    console.log(`\nServer beendet (Code ${code}).`);
    process.exitCode = code ?? 0;
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main().catch((err) => {
  console.error("\nFehler beim Starten:", err.message);
  process.exitCode = 1;
});
