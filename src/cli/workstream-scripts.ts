import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function resolveScriptsDir(): string {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error("Cannot resolve scripts directory");
  }
  const realEntry = fs.realpathSync(entry);
  const repoRoot = path.dirname(realEntry);
  const scriptsDir = path.join(repoRoot, "scripts", "workstream");
  if (!fs.existsSync(scriptsDir)) {
    throw new Error(`Workstream scripts not found at ${scriptsDir}`);
  }
  return scriptsDir;
}

export function runWorkstreamScript(scriptName: string, args: string[]): Promise<number> {
  const scriptsDir = resolveScriptsDir();
  const scriptPath = path.join(scriptsDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.once("exit", (code) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });
}
