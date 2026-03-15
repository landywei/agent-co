import type { Request, Response } from "express";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PlatformDb } from "../db/index.js";
import type { OrgId } from "../types.js";

const log = createSubsystemLogger("platform:proxy");

export interface OrgProxyConfig {
  timeout: number;
  maxRetries: number;
  retryDelay: number;
}

export interface OrgProxy {
  proxyRequest(orgId: OrgId, req: Request, res: Response): Promise<void>;
  proxyWebSocket(orgId: OrgId, req: Request, socket: unknown, head: Buffer): Promise<void>;
  getOrgEndpoint(orgId: OrgId): Promise<string | null>;
}

export async function createOrgProxy(db: PlatformDb, config: OrgProxyConfig): Promise<OrgProxy> {
  const http = await import("node:http");

  async function getOrgPort(orgId: OrgId): Promise<number | null> {
    const container = await db.containers.findByOrgId(orgId);
    if (!container || container.status !== "running") {
      return null;
    }
    return container.port;
  }

  return {
    async proxyRequest(orgId, req, res) {
      const port = await getOrgPort(orgId);
      if (!port) {
        res.status(503).json({ error: "Organization gateway not available" });
        return;
      }

      const targetUrl = `http://localhost:${port}${req.url}`;
      log.debug(`Proxying request to org ${orgId}: ${req.method} ${targetUrl}`);

      try {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") {
            headers[key] = value;
          } else if (Array.isArray(value)) {
            headers[key] = value.join(", ");
          }
        }
        delete headers.host;

        const response = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
          signal: AbortSignal.timeout(config.timeout),
        });

        res.status(response.status);
        for (const [key, value] of response.headers.entries()) {
          if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        }

        const body = await response.arrayBuffer();
        res.send(Buffer.from(body));
      } catch (error) {
        log.error(`Proxy error for org ${orgId}: ${String(error)}`);
        if (!res.headersSent) {
          res.status(502).json({ error: "Gateway proxy error" });
        }
      }
    },

    async proxyWebSocket(orgId, req, socket, _head) {
      const port = await getOrgPort(orgId);
      if (!port) {
        const sock = socket as import("node:net").Socket;
        sock.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        sock.destroy();
        return;
      }

      log.debug(`Proxying WebSocket to org ${orgId}: port ${port}`);

      const targetReq = http.request({
        hostname: "localhost",
        port,
        path: req.url,
        method: "GET",
        headers: {
          ...req.headers,
          host: `localhost:${port}`,
        },
      });

      targetReq.on("upgrade", (targetRes, targetSocket, targetHead) => {
        const sock = socket as import("node:net").Socket;
        sock.write(
          `HTTP/1.1 101 Switching Protocols\r\n` +
            `Upgrade: ${targetRes.headers.upgrade}\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Accept: ${targetRes.headers["sec-websocket-accept"]}\r\n` +
            `\r\n`,
        );

        if (targetHead.length > 0) {
          sock.write(targetHead);
        }

        targetSocket.pipe(sock);
        sock.pipe(targetSocket);

        targetSocket.on("error", (err) => {
          log.error(`Target WebSocket error for org ${orgId}: ${String(err)}`);
          sock.destroy();
        });

        sock.on("error", (err) => {
          log.error(`Client WebSocket error for org ${orgId}: ${String(err)}`);
          targetSocket.destroy();
        });
      });

      targetReq.on("error", (err) => {
        log.error(`WebSocket proxy error for org ${orgId}: ${String(err)}`);
        const sock = socket as import("node:net").Socket;
        sock.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        sock.destroy();
      });

      targetReq.end();
    },

    async getOrgEndpoint(orgId) {
      const port = await getOrgPort(orgId);
      if (!port) {
        return null;
      }
      return `http://localhost:${port}`;
    },
  };
}
