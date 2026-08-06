import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Native "Open file" dialog. Returns absolute path or null if cancelled.
 * @param {{ prompt?: string, defaultPath?: string }} [opts]
 */
export async function pickOpenJobFile(opts = {}) {
  const prompt = opts.prompt ?? "Job-Datei laden";
  const defaultPath = opts.defaultPath;

  if (process.platform === "darwin") {
    const lines = [
      `set thePrompt to "${escapeAppleScriptString(prompt)}"`,
      defaultPath
        ? `set theDefault to POSIX file "${escapeAppleScriptString(path.resolve(defaultPath))}"`
        : null,
      defaultPath
        ? `set theFile to choose file with prompt thePrompt of type {"public.json", "json"} default location theDefault`
        : `set theFile to choose file with prompt thePrompt of type {"public.json", "json"}`,
      `return POSIX path of theFile`,
    ].filter(Boolean);
    return runOsascript(lines.join("\n"));
  }

  if (process.platform === "win32") {
    return runWindowsOpenDialog(prompt, defaultPath);
  }

  throw new Error("Dateidialog wird auf diesem Betriebssystem nicht unterstützt.");
}

/**
 * Native "Save as" dialog. Returns absolute path or null if cancelled.
 * @param {{ prompt?: string, defaultName?: string, defaultPath?: string }} [opts]
 */
export async function pickSaveJobFile(opts = {}) {
  const prompt = opts.prompt ?? "Job speichern unter";
  const defaultName = opts.defaultName ?? "room-flythrough.room-flythrough.job.json";
  const defaultPath = opts.defaultPath;

  if (process.platform === "darwin") {
    const lines = [
      `set thePrompt to "${escapeAppleScriptString(prompt)}"`,
      `set theName to "${escapeAppleScriptString(defaultName)}"`,
      defaultPath
        ? `set theDefault to POSIX file "${escapeAppleScriptString(path.resolve(defaultPath))}"`
        : null,
      defaultPath
        ? `set theFile to choose file name with prompt thePrompt default name theName default location theDefault`
        : `set theFile to choose file name with prompt thePrompt default name theName`,
      `return POSIX path of theFile`,
    ].filter(Boolean);
    return runOsascript(lines.join("\n"));
  }

  if (process.platform === "win32") {
    return runWindowsSaveDialog(prompt, defaultName, defaultPath);
  }

  throw new Error("Dateidialog wird auf diesem Betriebssystem nicht unterstützt.");
}

/**
 * Native "Save as" dialog for MP4. Returns absolute path or null if cancelled.
 * @param {{ prompt?: string, defaultName?: string, defaultPath?: string }} [opts]
 */
export async function pickSaveMp4File(opts = {}) {
  const prompt = opts.prompt ?? "Video speichern unter";
  const defaultName = ensureMp4Extension(opts.defaultName ?? "room-flythrough.mp4");
  const defaultPath = opts.defaultPath;

  if (process.platform === "darwin") {
    const lines = [
      `set thePrompt to "${escapeAppleScriptString(prompt)}"`,
      `set theName to "${escapeAppleScriptString(defaultName)}"`,
      defaultPath
        ? `set theDefault to POSIX file "${escapeAppleScriptString(path.resolve(defaultPath))}"`
        : null,
      defaultPath
        ? `set theFile to choose file name with prompt thePrompt default name theName default location theDefault`
        : `set theFile to choose file name with prompt thePrompt default name theName`,
      `return POSIX path of theFile`,
    ].filter(Boolean);
    const picked = await runOsascript(lines.join("\n"));
    return picked ? ensureMp4Extension(picked) : null;
  }

  if (process.platform === "win32") {
    const picked = await runWindowsSaveMp4Dialog(prompt, defaultName, defaultPath);
    return picked ? ensureMp4Extension(picked) : null;
  }

  throw new Error("Dateidialog wird auf diesem Betriebssystem nicht unterstützt.");
}

/**
 * Native "Choose folder" dialog.
 * @param {{ prompt?: string, defaultPath?: string }} [opts]
 */
export async function pickFolder(opts = {}) {
  const prompt = opts.prompt ?? "Ordner auswählen";
  const defaultPath = opts.defaultPath;

  if (process.platform === "darwin") {
    const lines = [
      `set thePrompt to "${escapeAppleScriptString(prompt)}"`,
      defaultPath
        ? `set theDefault to POSIX file "${escapeAppleScriptString(path.resolve(defaultPath))}"`
        : null,
      defaultPath
        ? `set theFolder to choose folder with prompt thePrompt default location theDefault`
        : `set theFolder to choose folder with prompt thePrompt`,
      `return POSIX path of theFolder`,
    ].filter(Boolean);
    return runOsascript(lines.join("\n"));
  }

  if (process.platform === "win32") {
    return runWindowsFolderDialog(prompt);
  }

  throw new Error("Ordnerdialog wird auf diesem Betriebssystem nicht unterstützt.");
}

async function runOsascript(script) {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
    });
    const p = stdout.trim();
    return p || null;
  } catch (err) {
    // User cancelled → osascript exit 1 / -128
    const msg = err instanceof Error ? err.message : String(err);
    if (/User canceled|(-128)|canceled/i.test(msg) || err?.code === 1) {
      return null;
    }
    throw err;
  }
}

async function runWindowsOpenDialog(prompt, defaultPath) {
  const initial = defaultPath ? path.resolve(defaultPath).replace(/'/g, "''") : "";
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = '${prompt.replace(/'/g, "''")}'
$d.Filter = 'Job JSON (*.json)|*.json|All files (*.*)|*.*'
${initial ? `$d.InitialDirectory = '${initial}'` : ""}
$d.Multiselect = $false
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }
`;
  return runPowershell(ps);
}

async function runWindowsSaveDialog(prompt, defaultName, defaultPath) {
  const initial = defaultPath ? path.resolve(defaultPath).replace(/'/g, "''") : "";
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = '${prompt.replace(/'/g, "''")}'
$d.Filter = 'Job JSON (*.json)|*.json|All files (*.*)|*.*'
$d.FileName = '${defaultName.replace(/'/g, "''")}'
${initial ? `$d.InitialDirectory = '${initial}'` : ""}
$d.OverwritePrompt = $true
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }
`;
  return runPowershell(ps);
}

async function runWindowsSaveMp4Dialog(prompt, defaultName, defaultPath) {
  const initial = defaultPath ? path.resolve(defaultPath).replace(/'/g, "''") : "";
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = '${prompt.replace(/'/g, "''")}'
$d.Filter = 'MP4 (*.mp4)|*.mp4|All files (*.*)|*.*'
$d.DefaultExt = 'mp4'
$d.AddExtension = $true
$d.FileName = '${defaultName.replace(/'/g, "''")}'
${initial ? `$d.InitialDirectory = '${initial}'` : ""}
$d.OverwritePrompt = $true
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }
`;
  return runPowershell(ps);
}

async function runWindowsFolderDialog(prompt) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${prompt.replace(/'/g, "''")}'
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }
`;
  return runPowershell(ps);
}

async function runPowershell(script) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    { timeout: 300_000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  const p = stdout.trim();
  return p || null;
}

export function ensureJobJsonExtension(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) return filePath;
  return `${filePath}.room-flythrough.job.json`;
}

export function ensureMp4Extension(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".mp4")) return filePath;
  return `${filePath}.mp4`;
}

export function defaultDialogDir(folder) {
  if (folder && folder.trim()) return path.resolve(folder.trim());
  return os.homedir();
}
