import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ClientCredentialsProvider } from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Keep the local integration read-only even if the hosted service gains write tools.
export const READ_ONLY_TOOLS = new Set([
  "list_filings", "get_filing_details", "get_filing_summary", "list_filing_forms",
  "get_form", "get_efile_status", "get_efile_errors", "list_payers", "get_payer",
  "list_filing_types",
]);

export function readConfig(env) {
  const clientId = env.BOOMTAX_CLIENT_ID?.trim();
  const clientSecret = env.BOOMTAX_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("OAuth client credentials are required.");
  const baseUrl = new URL(env.BOOMTAX_API_URL || "https://api.boomtax.com");
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") {
    throw new Error("BOOMTAX_API_URL must be an origin without credentials, query, or path.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback)) {
    throw new Error("HTTPS is required except for a local test server.");
  }
  return { baseUrl, clientId, clientSecret };
}

export function createBridge({ baseUrl, clientId, clientSecret }) {
  const remote = new Client({ name: "boomtax-local-client", version });
  const provider = new ClientCredentialsProvider({
    clientId,
    clientSecret,
    expectedIssuer: baseUrl.href,
  });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
    authProvider: provider,
  });
  const server = new Server({ name: "boomtax", version }, { capabilities: { tools: {} } });
  let closing;
  const close = () => closing ??= Promise.resolve().then(() => Promise.allSettled([server.close(), remote.close()]));

  // Start stdio independently so EOF can cancel even a stalled upstream startup.
  const ready = remote.connect(transport);
  void ready.catch(close);

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    try {
      await ready;
      const result = await remote.listTools(request.params, { signal: extra.signal });
      return { ...result, tools: result.tools.filter(tool => READ_ONLY_TOOLS.has(tool.name)) };
    } catch {
      throw new McpError(ErrorCode.InternalError, "Unable to list BoomTax tools. Check API access and reconnect.");
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!READ_ONLY_TOOLS.has(request.params.name)) {
      throw new McpError(ErrorCode.InvalidParams, "This integration only exposes the documented read-only BoomTax tools.");
    }
    try {
      await ready;
      // Forward the hosted schemas and results unchanged, including masked fields,
      // pagination, structured content, and MCP tool errors.
      return await remote.callTool(request.params, undefined, { signal: extra.signal });
    } catch {
      throw new McpError(ErrorCode.InternalError, "BoomTax tool request failed. Check API access and reconnect.");
    }
  });
  return { server, close, ready };
}
