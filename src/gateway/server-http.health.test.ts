import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";
import { createGatewayHttpServer } from "./server-http.js";
import { withTempConfig } from "./test-temp-config.js";

function createRequest(params: { path: string; method?: string }): IncomingMessage {
  return {
    method: params.method ?? "GET",
    url: params.path,
    headers: { host: "localhost:18789" },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
}

function createResponse(): {
  res: ServerResponse;
  end: ReturnType<typeof vi.fn>;
  getBody: () => string;
} {
  let body = "";
  const end = vi.fn((chunk?: unknown) => {
    if (typeof chunk === "string") {
      body = chunk;
    }
  });
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader: vi.fn(),
    end,
  } as unknown as ServerResponse;
  return { res, end, getBody: () => body };
}

async function dispatchRequest(
  server: ReturnType<typeof createGatewayHttpServer>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  server.emit("request", req, res);
  await new Promise((resolve) => setImmediate(resolve));
}

describe("gateway /health", () => {
  test("returns JSON 200 and skips hooks", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };

    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "openclaw-gateway-health-test-",
      run: async () => {
        const handleHooksRequest = vi.fn(async () => false);
        const server = createGatewayHttpServer({
          canvasHost: null,
          clients: new Set(),
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest,
          resolvedAuth,
        });

        const { res, getBody } = createResponse();
        await dispatchRequest(server, createRequest({ path: "/health" }), res);

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(getBody())).toEqual({ ok: true, service: "openclaw-gateway" });
        expect(handleHooksRequest).not.toHaveBeenCalled();
      },
    });
  });

  test("HEAD returns 200 with empty body", async () => {
    const resolvedAuth: ResolvedGatewayAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };

    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "openclaw-gateway-health-head-test-",
      run: async () => {
        const server = createGatewayHttpServer({
          canvasHost: null,
          clients: new Set(),
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const { res, getBody } = createResponse();
        await dispatchRequest(server, createRequest({ path: "/health", method: "HEAD" }), res);

        expect(res.statusCode).toBe(200);
        expect(getBody()).toBe("");
      },
    });
  });
});
