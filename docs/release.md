# Release and directory maintenance

Version 2.0.0 is an unreleased replacement for the password-based npm 1.0.0 client. The environment variable change is intentionally a major version change. Publication of this branch, npm release, API deployment, and registry submissions are separate operations.

## Required release order

1. Review and deploy the API compatibility changes: matching issuer metadata, public-client token authentication metadata, supported ChatGPT/Claude/VS Code callback hosts, RFC 8707 resource indicators, and read-only tool annotations.
2. Use a designated demo/test account to complete an authenticated remote OAuth connection and call all ten tools. Test Claude, ChatGPT, and Codex separately before claiming verified compatibility. Confirm revocation prevents new access, and reconnect after token expiry.
3. Review the local client changes and run `npm ci`, `npm test`, `npm run check`, and `npm pack --dry-run`. Inspect the package file list for accidental secrets or unrelated files.
4. With an authorized npm publisher account, publish 2.0.0 with public access. Confirm the registry metadata and tarball contents match the reviewed version. Update the README's release-status paragraph once publication and API deployment are verified.
5. Publish `server.json` to the official MCP Registry using an authorized member of the `boomtax` GitHub organization. Its npm package version must already exist. Follow the [official publishing guide](https://modelcontextprotocol.io/registry/quickstart); authenticate with the publisher CLI and submit the checked-in manifest. Verify the saved entry by name and version.
6. Submit the hosted endpoint to [awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers) after the public setup guide is current. The local client may also qualify for installable-server lists once its source and npm release are published.

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
