# BoomTax MCP Server

Read-only BoomTax filing tools for Claude, ChatGPT, Codex, Cursor, Windsurf, VS Code Copilot, and other Model Context Protocol clients.

The hosted endpoint is **https://api.boomtax.com/mcp**, using Streamable HTTP and OAuth. API access must be enabled on your BoomTax account; contact [support@boomtax.com](mailto:support@boomtax.com) if needed.

> Release status: version 2.0.0 is prepared in this source tree. The published npm 1.0.0 client uses legacy password authentication. Until 2.0.0 is published, use a remote connection or run the local client from this source tree. Cloud OAuth compatibility also requires the corresponding API update; see [release validation](docs/release.md).

## Tools

| Tool | Description |
|---|---|
| `list_filings` | Filter filings by year, form type, and status; includes filing system |
| `get_filing_details` | Filing details, payer summary, and e-file status |
| `get_filing_summary` | Counts by status and form type |
| `list_filing_forms` | Paginated form metadata within a filing |
| `get_form` | Form metadata, status, and dates |
| `get_efile_status` | E-file request and response timeline |
| `get_efile_errors` | E-file errors and messages |
| `list_payers` | Payers across accessible filings |
| `get_payer` | Payer details, including a masked payer TIN |
| `list_filing_types` | Available filing types, tax years, and filing systems |

These tools cannot create, edit, delete, or submit filings. The local client forwards these ten tools to the hosted service and blocks other tool names. Use `list_filing_types` for current form availability, rather than a static list that can go stale each tax year.

## Setup

### Remote connection (recommended)

Use `https://api.boomtax.com/mcp` in a client that supports Streamable HTTP and OAuth with PKCE. Complete the browser sign-in when prompted. OAuth client registration uses Dynamic Client Registration (DCR); choose automatic registration if your client offers a choice between DCR and a published client identity. Client ID Metadata Documents (CIMD) are not currently supported.

Discovery endpoints:

- `https://api.boomtax.com/.well-known/oauth-protected-resource`
- `https://api.boomtax.com/.well-known/oauth-authorization-server`

A `401` response when opening `/mcp` without authentication is expected. It includes a `WWW-Authenticate` discovery header. A bare URL in a browser is not an authenticated connection test.

### Local client (version 2)

Requires Node.js 22 or newer. Create a **read-scoped** API credential at [BoomTax API credentials](https://boomtax.com/Account/Api/Create). Supply the values through your client's secret storage or environment:

| Variable | Required | Purpose |
|---|---|---|
| `BOOMTAX_CLIENT_ID` | Yes | API credential client ID |
| `BOOMTAX_CLIENT_SECRET` | Yes | API credential secret |
| `BOOMTAX_API_URL` | No | Defaults to `https://api.boomtax.com`; specify an origin, not `/mcp` |

The client obtains short-lived OAuth tokens and authenticates again when a token expires. It does not use an account email/password. HTTP is allowed only for loopback development servers; other origins require HTTPS.

Run the source version after setting those environment variables:

```sh
git clone https://github.com/boomtax/mcp-server.git
cd mcp-server
npm ci
node index.js
```

After the 2.0.0 release is published, the equivalent package command is:

```sh
npx -y @boomtax/mcp-server@2.0.0
```

On Windows, clients that cannot spawn `npx` directly can use `cmd /c npx -y @boomtax/mcp-server@2.0.0`, or invoke the installed client with `node` and an absolute path to `index.js`.

## Configuration by AI client

### Claude Desktop and Claude web

For a remote connection, open **Connectors**, add a custom connector, and enter `https://api.boomtax.com/mcp`. Choose automatic OAuth client registration and complete sign-in. Organization accounts may require an administrator to add the connector first. Remote connectors are configured through the connector UI, not a URL-only entry in `claude_desktop_config.json`.

For a local source install in Claude Desktop, use an absolute path and inject the two credential environment variables securely:

```json
{
  "mcpServers": {
    "boomtax": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/index.js"],
      "env": {
        "BOOMTAX_CLIENT_ID": "YOUR_READ_SCOPED_CLIENT_ID",
        "BOOMTAX_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

Keep files containing secrets outside source control. Windows paths in JSON need doubled backslashes or forward slashes.

### Claude Code

```sh
claude mcp add boomtax --transport http https://api.boomtax.com/mcp
```

Use `/mcp` in Claude Code to complete authentication.

### ChatGPT

In a workspace that permits custom MCP connections, add a custom connector or plugin with URL `https://api.boomtax.com/mcp`, choose OAuth and automatic client registration, then complete sign-in. The exact UI and availability depend on your workspace controls. If asked for a pre-registered OAuth client instead, contact BoomTax support; a machine-to-machine API credential is not an authorization-code client registration.

### Codex

```sh
codex mcp add boomtax --url https://api.boomtax.com/mcp
codex mcp login boomtax
```

Codex uses the hosted server's OAuth discovery metadata. A local stdio client can also run `node` with the source path above and inherit `BOOMTAX_CLIENT_ID` and `BOOMTAX_CLIENT_SECRET` from its environment.

### Cursor and Windsurf

Add this remote server to your client's MCP configuration, then complete OAuth sign-in:

```json
{
  "mcpServers": {
    "boomtax": {
      "url": "https://api.boomtax.com/mcp"
    }
  }
}
```

Cursor uses `.cursor/mcp.json`. In Windsurf or Devin Desktop, use the MCP settings' **Open MCP config file** action to select the configuration for your installed version. If a client version does not support OAuth for remote servers, use the local source configuration instead.

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "boomtax": {
      "type": "http",
      "url": "https://api.boomtax.com/mcp"
    }
  }
}
```

Start the server from VS Code's MCP controls and complete OAuth sign-in. This configuration contains no account secrets.

## Example prompts

- "What filings do I have for tax year 2025?"
- "Summarize my filings by status."
- "What is the e-file status of this filing?"
- "Show errors on my 1099-NEC filing."
- "Which filing types and tax years are available?"

## Security and troubleshooting

- Data access is scoped to the authenticated account and its filing permissions.
- Structured payer TIN fields are masked by the hosted service. Results still contain confidential names, contact details, and filing information; share them only with authorized assistants.
- Use a separate read-scoped API credential per local integration, and revoke it in BoomTax when no longer needed.
- Credentials are kept in memory by the local client. It pins OAuth discovery to the configured API issuer and does not log upstream error bodies or credentials.
- A local startup failure usually means missing client credentials, disabled API access, or an unreachable API. Do not supply `BOOMTAX_API_USERNAME` / `BOOMTAX_API_PASSWORD`; these version 1 settings are obsolete.
- An `invalid_redirect_uri` registration error requires a supported callback host or a support-assisted registration. Never work around it by sending credentials to another host.
- Directory health checks need an authorized test connection. A missing test profile can produce an unhealthy badge even when OAuth discovery is reachable.

## Development

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

Tests use a loopback OAuth/MCP fixture and synthetic data, including a real stdio client process. They do not connect to customer accounts. See [release and directory maintenance](docs/release.md) for publication prerequisites and verification.

## License

The local client source in this repository is [MIT licensed](LICENSE). Access to the hosted BoomTax service remains subject to BoomTax's service terms and account permissions.
