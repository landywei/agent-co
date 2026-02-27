import { execFile } from "node:child_process";
import path from "node:path";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function findRepoRoot(): string {
  return process.cwd();
}

const CREATE_COMPANY_SCRIPT = "scripts/workstream/create-company.mjs";

export const companyBootstrapHandlers: GatewayRequestHandlers = {
  "company.create": async ({ params, respond }) => {
    const goal = typeof params.goal === "string" ? params.goal.trim() : "";
    if (!goal) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "goal is required"));
      return;
    }

    const repoRoot = findRepoRoot();
    const scriptPath = path.join(repoRoot, CREATE_COMPANY_SCRIPT);

    try {
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [scriptPath, goal],
          { cwd: repoRoot, timeout: 30_000, env: { ...process.env } },
          (err, stdout, stderr) => {
            if (err) {
              reject(new Error(stderr || stdout || err.message));
              return;
            }
            resolve(stdout + (stderr ? `\n${stderr}` : ""));
          },
        );
      });
      respond(true, { output });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `create-company failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  },
};
