# Build Room Flythrough Studio for Windows (NSIS installer + .exe)
# Run in PowerShell FROM a Windows machine (not macOS — no cross-compile).
# Prerequisites: Node.js, Rust (MSVC), WebView2
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")
Set-Location $Root

# Fail before the ~150 MB Node download rather than after it.
foreach ($tool in @("node", "cargo")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool nicht gefunden. Node.js: https://nodejs.org/ | Rust (MSVC): https://rustup.rs/"
  }
}

Write-Host "==> Project: $Root"
Write-Host "==> Step 1/3: portable Node + Remotion bundle"
& "$Root\scripts\standalone\build_node_runtime.ps1"
if ($LASTEXITCODE -ne 0) { throw "build_node_runtime.ps1 failed" }

Write-Host "==> Step 2/3: pnpm install (root)"
corepack pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Host "==> Step 3/3: tauri build (nsis)"
$env:CI = "true"
# `pnpm run <script> -- --flag` forwards the `--` literally (npm strips it), and
# the Tauri CLI reads everything after `--` as cargo arguments. Calling the CLI
# through `pnpm exec` avoids that ambiguity entirely.
corepack pnpm exec tauri build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$BundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
$DistDir = Join-Path $Root "dist-win"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
if (Test-Path $BundleDir) {
  Copy-Item (Join-Path $BundleDir "*") -Destination $DistDir -Force
}

Write-Host ""
Write-Host "Done. Installer / exe:"
Get-ChildItem $DistDir -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host "Also under: $BundleDir"
