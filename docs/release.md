# Release and directory maintenance

The hosted API compatibility update is deployed, and the remote server is active in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.boomtax%2Fmcp-server) as `io.github.boomtax/mcp-server`, version 2.0.0, published October 9, 2026. The checked-in `server.json` matches that remote-only publication.

The local client source is available on `main`. Its npm 2.0.0 package remains unpublished, so the public npm 1.0.0 package still uses legacy password authentication. The environment variable change is intentionally a major version change. Source publication, npm release, API deployment, and directory submissions are separate operations.

Production verification covered OAuth discovery, authenticated MCP initialization, and discovery of all ten read-only tools. That does not establish an authenticated end-to-end connection in every named client; complete the client checks below before claiming verified compatibility.

## Release and validation steps

1. Review and deploy the API compatibility changes: matching issuer metadata, public-client token authentication metadata, supported ChatGPT/Claude/VS Code callback hosts, RFC 8707 resource indicators, and read-only tool annotations.
2. Use a designated demo/test account to complete an authenticated remote OAuth connection and call all ten tools. Test Claude, ChatGPT, and Codex separately before claiming verified compatibility. Confirm revocation prevents new access, and reconnect after token expiry.
3. Review the local client changes and run `npm ci`, `npm test`, `npm run check`, and `npm pack --dry-run`. Inspect the package file list for accidental secrets or unrelated files.
4. Publish the hosted endpoint independently using a remote-only `server.json`. Follow the [official publishing guide](https://modelcontextprotocol.io/registry/quickstart), authenticate as an authorized member of the `boomtax` GitHub organization, and verify the saved entry by name and version. This step is complete for registry version 2.0.0; it does not require an npm package.
5. With an authorized npm publisher account, publish npm 2.0.0 with public access. Confirm the package metadata and tarball contents match the reviewed version, then update the README's release-status paragraph. To add npm installation to the official MCP Registry afterward, add the published package and its required credential environment variables to `server.json` and increment the server version (for example, to 2.0.1). Published registry versions are immutable; the server version and npm package version can differ.
6. Submit the hosted endpoint to remote-server lists and the public source repository to installable-server lists. Treat submitted requests as pending until maintainers accept them; an automated check alone does not establish publication.

## Distribution requests (October 9, 2026)

| Directory | Status |
|---|---|
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.boomtax%2Fmcp-server) | Active remote-only entry, version 2.0.0. |
| [awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/1511) | Submitted; endpoint and connector checks passed. Maintainer review pending. |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers/pull/16079) | Submitted; requires a separate Glama installable-server entry and score badge. The existing hosted connector does not satisfy that check. |
| [PulseMCP](https://www.pulsemcp.com/submit) | Submissions are temporarily paused. The directory recommends official MCP Registry publication and says it will resume importing entries when its pipeline reopens. |

## Existing listings

| Listing | Maintenance needed |
|---|---|
| [Glama](https://glama.ai/mcp/connectors/com.boomtax.api/boom-tax-1099-w-2-aca-filing) | Inspect Admin / Test Profile, reconnect with an approved test account, then rerun the authenticated check. Never supply a real customer's credentials. |
| [Smithery](https://smithery.ai/servers/boomtax/mcp-server) | Reconnect and verify tools; update any description implying write or submission tools. |
| [SafeMCP](https://safemcp.info/s/boomtax/mcp-server/) | Replace placeholder installation guidance with the supported remote connection or released local client. |
| [tax-oss](https://tax-oss.com/projects/) | Point maintainers to the corrected MIT client license and OAuth setup, if the listing remains stale. |

Suggested directory description:

> Read-only BoomTax MCP integration for IRS information-return workflows. Query filings, form metadata, payers, e-file status, and errors using ten tools. Remote Streamable HTTP with OAuth; optional local Node.js client using scoped API credentials. API-enabled BoomTax account required. Cannot create, edit, delete, or submit filings.

## Health checks

Unauthenticated `/mcp` returns 401 by design. Both OAuth discovery documents must return valid JSON. The authorization-server `issuer` and protected-resource `authorization_servers` value must match exactly, including the trailing slash. Public PKCE clients must see `none` in `token_endpoint_auth_methods_supported`.

A directory badge is not evidence of an authenticated end-to-end test. Preserve the tool-discovery result, test time, client version, and sanitized error details when diagnosing a failure. Do not copy tokens, secrets, or taxpayer data into issues or directory submissions.

For a Debug API on a port other than 5001, set `BoomTaxApi__LocalMcpResource` to its exact HTTPS `/mcp` URL. Production accepts only `https://api.boomtax.com/mcp`; unrecognized OAuth resource indicators remain rejected.
