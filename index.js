#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridge, readConfig } from "./src/bridge.js";

let bridge;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await bridge?.close();
  process.exit(0);
}
// The SDK's stdio transport does not propagate stdin EOF to server.onclose.
process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, shutdown);

try {
  bridge = createBridge(readConfig(process.env));
  bridge.server.onclose = () => { void shutdown(); };
  await bridge.server.connect(new StdioServerTransport());
  await bridge.ready;
} catch {
  if (stopping) process.exit(0);
  stopping = true;
  // Never print upstream response bodies or credential-bearing errors to client logs.
  console.error("BoomTax MCP could not connect. Set BOOMTAX_CLIENT_ID and BOOMTAX_CLIENT_SECRET from a read-scoped API credential, then check API access and BOOMTAX_API_URL. Account email/password login is no longer supported.");
  await bridge?.close();
  process.exitCode = 1;
}
