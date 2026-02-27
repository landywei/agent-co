import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const STATE_DIR_FILES = [
  "company/",
  "workspace/",
  "reset-ts.js",
  "agents-data.js",
  "kb-data.js",
  "channels-data.js",
  "company-state.json",
];

const LISTABLE_DIRS = ["company/kb", "workspace/kb"];

function resolveAssetsDir(): string | null {
  const entry = process.argv[1];
  if (!entry) {
    return null;
  }
  try {
    const realEntry = fs.realpathSync(entry);
    let dir = path.dirname(realEntry);
    for (let i = 0; i < 3; i++) {
      const candidate = path.join(dir, "assets");
      if (fs.existsSync(path.join(candidate, "workstream.html"))) {
        return candidate;
      }
      dir = path.dirname(dir);
    }
    return null;
  } catch {
    return null;
  }
}

function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
  } else {
    res.end(fs.readFileSync(filePath));
  }
  return true;
}

export function handleWorkstreamHttpRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const rel = url.pathname.replace(/^\/+/, "");
  if (!rel) {
    return false;
  }

  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith("..") || normalized.includes("\0")) {
    return false;
  }

  if (rel === "workstream.html") {
    const assetsDir = resolveAssetsDir();
    if (assetsDir) {
      const filePath = path.join(assetsDir, "workstream.html");
      if (serveFile(req, res, filePath)) {
        return true;
      }
    }
    return false;
  }

  // Directory listing for KB discovery (returns JSON array of filenames)
  if (rel.startsWith("_ls/")) {
    const dirRel = rel.slice(4);
    if (!LISTABLE_DIRS.some((d) => dirRel === d || dirRel.startsWith(d + "/"))) {
      return false;
    }
    const stateDir = resolveStateDir();
    const dirPath = path.join(stateDir, path.posix.normalize(dirRel));
    if (!dirPath.startsWith(stateDir)) {
      return false;
    }
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .toSorted();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end(JSON.stringify(files));
      return true;
    } catch {
      res.statusCode = 404;
      res.end("[]");
      return true;
    }
  }

  if (!STATE_DIR_FILES.some((p) => rel === p || rel.startsWith(p))) {
    return false;
  }

  const stateDir = resolveStateDir();
  const filePath = path.join(stateDir, normalized);
  if (!filePath.startsWith(stateDir)) {
    return false;
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(filePath);
  } catch {
    return false;
  }

  return serveFile(req, res, realPath);
}
