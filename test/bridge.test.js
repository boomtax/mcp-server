import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBridge, readConfig } from "../src/bridge.js";

// All HTTP traffic stays on loopback and uses synthetic OAuth credentials and forms.
async function fixture(t) {
  const state = { tokens: 0, tokenRequests: [], calls: [], expired: false, failCall: false, wrongIssuer: false };
  let base;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const send = (status, value, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    if (req.url.startsWith("/.well-known/oauth-protected-resource")) {
      return send(200, { resource: `${base}mcp`, authorization_servers: [state.wrongIssuer ? "https://untrusted.invalid/" : base] });
    }
    if (req.url === "/.well-known/oauth-authorization-server") {
      return send(200, {
        issuer: base, token_endpoint: `${base}oauth/token`,
        authorization_endpoint: `${base}oauth/authorize`, response_types_supported: ["code"],
        grant_types_supported: ["client_credentials"], token_endpoint_auth_methods_supported: ["client_secret_basic"],
      });
    }
    if (req.url === "/oauth/token") {
      state.tokenRequests.push({ headers: req.headers, body });
      const valid = req.headers.authorization === `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`;
      if (!valid) return send(401, { error: "invalid_client" });
      state.expired = false;
      return send(200, { access_token: `test-token-${++state.tokens}`, token_type: "Bearer", expires_in: 3600 });
    }
    if (req.url !== "/mcp") return send(404, {});
    if (state.expired || req.headers.authorization !== `Bearer test-token-${state.tokens}` || state.tokens === 0) {
      return send(401, undefined, { "WWW-Authenticate": `Bearer resource_metadata="${base}.well-known/oauth-protected-resource"` });
    }
    if (req.method === "GET") {
      if (!state.sse) return send(405);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": keep-alive\n\n");
      state.onSse?.();
      return;
    }
    if (req.method === "DELETE") return send(204);
    const message = JSON.parse(body);
    if (message.id === undefined) return send(202);
    let result;
    if (message.method === "initialize") {
      state.onInitialize?.();
      if (state.stallInitialize) return;
      result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "mock-boomtax", version: "1.0.0" } };
    } else if (message.method === "tools/list") {
      result = { tools: [
        { name: "get_form", description: "Read form metadata", inputSchema: { type: "object", properties: { formId: { type: "string" } }, required: ["formId"] }, annotations: { readOnlyHint: true, destructiveHint: false } },
        { name: "delete_filing", description: "Must never be forwarded", inputSchema: { type: "object" } },
      ] };
    } else if (message.method === "tools/call") {
      state.calls.push(message.params);
      if (state.failCall) return send(500, { secret: "upstream-sensitive-error" });
      result = { content: [{ type: "text", text: JSON.stringify({ id: message.params.arguments.formId, tin: "***-**-1234", filingSystem: "IRIS" }) }] };
    } else return send(200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method" } });
    send(200, { jsonrpc: "2.0", id: message.id, result });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { state, config: readConfig({ BOOMTAX_API_URL: base, BOOMTAX_CLIENT_ID: "test-client", BOOMTAX_CLIENT_SECRET: "test-secret" }) };
}

test("stdio client authenticates with OAuth, preserves results, refreshes tokens, and blocks writes", async t => {
  const { state, config } = await fixture(t);
  const client = new Client({ name: "test-consumer", version: "1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../index.js", import.meta.url))],
    env: { BOOMTAX_API_URL: config.baseUrl.href, BOOMTAX_CLIENT_ID: config.clientId, BOOMTAX_CLIENT_SECRET: config.clientSecret },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", data => { stderr += data; });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ["get_form"]);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  const response = await client.callTool({ name: "get_form", arguments: { formId: "fake-form" } });
  assert.deepEqual(JSON.parse(response.content[0].text), { id: "fake-form", tin: "***-**-1234", filingSystem: "IRIS" });
  state.expired = true;
  await client.callTool({ name: "get_form", arguments: { formId: "another-form" } });
  assert.equal(state.tokens, 2);
  for (const request of state.tokenRequests) {
    const body = new URLSearchParams(request.body);
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.has("password"), false);
  }
  await assert.rejects(client.callTool({ name: "delete_filing", arguments: {} }), /read-only/);
  assert.equal(state.calls.length, 2);
  state.failCall = true;
  await assert.rejects(client.callTool({ name: "get_form", arguments: { formId: "fake-form" } }), error => {
    assert.match(error.message, /BoomTax tool request failed/);
    assert.doesNotMatch(error.message, /upstream-sensitive-error|test-secret/);
    return true;
  });
  assert.doesNotMatch(stderr, /test-secret|test-token|upstream-sensitive-error/);
});

test("credentials are not sent to a different discovered OAuth issuer", async t => {
  const { state, config } = await fixture(t);
  state.wrongIssuer = true;
  const bridge = createBridge(config);
  t.after(() => bridge.close());
  await assert.rejects(bridge.ready);
  assert.equal(state.tokenRequests.length, 0);
});

for (const phase of ["open SSE connection", "stalled startup"]) {
  test(`stdin EOF exits cleanly with ${phase}`, async t => {
    const { state, config } = await fixture(t);
    const started = new Promise(resolve => {
      if (phase === "open SSE connection") {
        state.sse = true;
        state.onSse = resolve;
      } else {
        state.stallInitialize = true;
        state.onInitialize = resolve;
      }
    });
    const child = spawn(process.execPath, [fileURLToPath(new URL("../index.js", import.meta.url))], {
      env: { ...process.env, BOOMTAX_API_URL: config.baseUrl.href, BOOMTAX_CLIENT_ID: config.clientId, BOOMTAX_CLIENT_SECRET: config.clientSecret },
      stdio: ["pipe", "pipe", "pipe"],
    });
    t.after(() => child.kill());
    child.stdout.resume();
    child.stderr.resume();
    const exited = once(child, "exit", { signal: AbortSignal.timeout(5000) });
    await started;
    child.stdin.end();
    const [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
  });
}

test("read-only names are enforced even without a preceding tools/list", async t => {
  const { state, config } = await fixture(t);
  const bridge = await createBridge(config);
  t.after(() => bridge.close());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-consumer", version: "1" });
  t.after(() => client.close());
  await bridge.server.connect(serverTransport);
  await client.connect(clientTransport);
  await assert.rejects(client.callTool({ name: "submit_filing", arguments: {} }), /read-only/);
  assert.deepEqual(state.calls, []);
});

test("configuration requires credentials and restricts HTTP to loopback", () => {
  const credentials = { BOOMTAX_CLIENT_ID: "id", BOOMTAX_CLIENT_SECRET: "secret" };
  assert.throws(() => readConfig({ BOOMTAX_API_USERNAME: "legacy", BOOMTAX_API_PASSWORD: "legacy" }));
  for (const url of ["http://api.boomtax.com", "https://user:password@api.boomtax.com", "https://api.boomtax.com/mcp", "https://api.boomtax.com?token=secret", "file:///tmp/file"]) {
    assert.throws(() => readConfig({ ...credentials, BOOMTAX_API_URL: url }));
  }
  assert.equal(readConfig(credentials).baseUrl.href, "https://api.boomtax.com/");
  assert.equal(readConfig({ ...credentials, BOOMTAX_API_URL: "http://127.0.0.1:4000" }).baseUrl.port, "4000");
});
