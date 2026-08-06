# Build portable Node.js runtime + copy app into src-tauri\resources\studio\
# Run on Windows before: corepack pnpm run tauri:build
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { "22.14.0" }
$OutDir = Join-Path $ProjectRoot "src-tauri\resources\studio"
$RuntimeDir = Join-Path $OutDir "runtime"
$AppDir = Join-Path $OutDir "app"

$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$NodeZip = "node-v$NodeVersion-win-$Arch.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZip"

Write-Host "==> Resetting $OutDir"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $RuntimeDir, $AppDir | Out-Null

$TmpZip = Join-Path $env:TEMP $NodeZip
Write-Host "==> Downloading Node $NodeVersion"
Invoke-WebRequest -Uri $NodeUrl -OutFile $TmpZip
Expand-Archive -Path $TmpZip -DestinationPath $RuntimeDir -Force
$Inner = Get-ChildItem $RuntimeDir -Directory | Select-Object -First 1
if ($Inner) {
  Get-ChildItem $Inner.FullName | Move-Item -Destination $RuntimeDir -Force
  Remove-Item $Inner.FullName -Force
}
Remove-Item $TmpZip -Force

Write-Host "==> Copying app sources"
# Only the Node/Remotion sidecar — never nest src-tauri/resources into itself,
# and never drag a previously built app (dist-mac/dist-win) into the bundle.
$Exclude = @(
  "node_modules", "out", "dist-webapp", "dist-mac", "dist-win",
  "src-tauri", "uploads", "jobs", ".git", ".npm-cache", ".remotion",
  "BUILD.md", "Start Studio.command", "Start Studio.bat",
  "Build Mac App.command", "Build Windows.bat"
)
Get-ChildItem $ProjectRoot -Force | Where-Object {
  $Exclude -notcontains $_.Name -and $_.Name -notlike "*_schaue-*.md"
} | ForEach-Object {
  Copy-Item $_.FullName -Destination $AppDir -Recurse -Force
}

# --node-linker=hoisted: a flat node_modules without symlinks/junctions.
# pnpm's default store layout does not survive Tauri's resource bundling.
# Prefer a store on the system drive — external NTFS volumes often fail
# mid-copy when the store lives on the same volume.
Write-Host "==> pnpm install in bundle"
$env:PATH = "$RuntimeDir;$env:PATH"
$PnpmStoreDir = if ($env:PNPM_STORE_DIR) { $env:PNPM_STORE_DIR } else { Join-Path $env:LOCALAPPDATA "pnpm\store" }
New-Item -ItemType Directory -Force -Path $PnpmStoreDir | Out-Null
Write-Host "    store: $PnpmStoreDir"
Push-Location $AppDir
corepack pnpm install --frozen-lockfile --node-linker=hoisted --store-dir $PnpmStoreDir
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "pnpm install in bundle failed" }
Write-Host "==> Pre-cache Remotion browser + FFmpeg"
corepack pnpm exec remotion browser ensure
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "remotion browser ensure failed" }
Pop-Location

"Room Flythrough Studio bundle`nNode: $NodeVersion win-$Arch`nBuilt: $(Get-Date -Format o)" | Out-File (Join-Path $OutDir "BUNDLE_INFO.txt")
Write-Host "==> Done: $OutDir"
