# BoomTax MCP Server

Query your BoomTax tax filing data from any AI assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io) — Claude, Cursor, Windsurf, VS Code Copilot, and more.

> **IRIS-Ready:** BoomTax files all 1099 forms through IRS IRIS. The `list_filing_types` and `list_filings` tools include a `filingSystem` field showing which IRS system each filing uses (IRIS, AIR, BSO, PDR). [Learn more about the FIRE-to-IRIS transition](https://www.boomtax.com/irs-iris)

## Tools

| Tool | Description |
|------|-------------|
| `list_filings` | List filings with filters (tax year, form type, status). Includes `filingSystem` field. |
| `get_filing_details` | Filing detail with payer summary and e-file status |
| `get_filing_summary` | Aggregate counts by status and form type |
| `list_filing_forms` | List forms in a filing |
| `get_form` | Form metadata (type, status, dates) |
| `get_efile_status` | E-file request/response timeline |
| `get_efile_errors` | E-file errors with codes and messages |
| `list_payers` | List payers across filings |
| `get_payer` | Payer details for a filing |
| `list_filing_types` | All supported filing types, e-file availability, and filing system (IRIS/AIR/BSO/PDR) |

All tools are read-only. TINs are always masked (last 4 digits only).

## Supported Filing Systems

| System | Forms | Status |
|--------|-------|--------|
| **IRIS** | 1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-K, 1099-R, 1099-SA, 1099-C, W-2G, 5498-SA | Active (replaces FIRE on Dec 31, 2026) |
| **AIR** | 1094-B, 1095-B, 1094-C, 1095-C | Active |
| **BSO** | W-2 | Active |
| **PDR** | 1099-HC | Active |

## Prerequisites

Your BoomTax account must have API access enabled. Contact [support@boomtax.com](mailto:support@boomtax.com) to request access.

## Setup

### Option A: Remote (recommended)

Connect directly to BoomTax — no install required. Requires a BoomTax API token.

### Option B: Local (npx)

```
npx @boomtax/mcp-server
```

Requires environment variables:
- `BOOMTAX_API_USERNAME` — your BoomTax email
- `BOOMTAX_API_PASSWORD` — your BoomTax password
- `BOOMTAX_API_URL` — (optional) defaults to `https://api.boomtax.com`

---

## Configuration by AI Client

### Claude Desktop

**Remote:**
```json
{
  "mcpServers": {
    "boomtax": {
      "url": "https://api.boomtax.com/mcp"
    }
  }
}
```

**Local:**
```json
{
  "mcpServers": {
    "boomtax": {
      "command": "npx",
      "args": ["@boomtax/mcp-server"],
      "env": {
        "BOOMTAX_API_URL": "https://api.boomtax.com",
        "BOOMTAX_API_USERNAME": "you@yourfirm.com",
        "BOOMTAX_API_PASSWORD": "your-password"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add boomtax --transport http https://api.boomtax.com/mcp
```

Or local:
```bash
claude mcp add boomtax -- npx @boomtax/mcp-server
```

### Cursor

Add to Cursor Settings > MCP Servers:

**Remote:**
```json
{
  "mcpServers": {
    "boomtax": {
      "url": "https://api.boomtax.com/mcp"
    }
  }
}
```

**Local:**
```json
{
  "mcpServers": {
    "boomtax": {
      "command": "npx",
      "args": ["@boomtax/mcp-server"],
      "env": {
        "BOOMTAX_API_URL": "https://api.boomtax.com",
        "BOOMTAX_API_USERNAME": "you@yourfirm.com",
        "BOOMTAX_API_PASSWORD": "your-password"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "boomtax": {
      "command": "npx",
      "args": ["@boomtax/mcp-server"],
      "env": {
        "BOOMTAX_API_URL": "https://api.boomtax.com",
        "BOOMTAX_API_USERNAME": "you@yourfirm.com",
        "BOOMTAX_API_PASSWORD": "your-password"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "boomtax": {
      "command": "npx",
      "args": ["@boomtax/mcp-server"],
      "env": {
        "BOOMTAX_API_URL": "https://api.boomtax.com",
        "BOOMTAX_API_USERNAME": "${input:boomtaxUsername}",
        "BOOMTAX_API_PASSWORD": "${input:boomtaxPassword}"
      }
    }
  },
  "inputs": [
    {
      "id": "boomtaxUsername",
      "type": "promptString",
      "description": "BoomTax API username (email)",
      "password": false
    },
    {
      "id": "boomtaxPassword",
      "type": "promptString",
      "description": "BoomTax API password",
      "password": true
    }
  ]
}
```

---

## Example Prompts

Once connected, try asking your AI assistant:

- "What filings do I have for tax year 2025?"
- "Show me a summary of all my filings"
- "What's the e-file status of my W-2 filing?"
- "Are there any e-file errors on my 1099-NEC filing?"
- "List all my payers"
- "What filing types does BoomTax support and which use IRIS?"

## Security

- All data access is scoped to your authenticated account
- TINs/SSNs are always masked (last 4 digits only)
- All tools are read-only — no data can be modified
- The local server authenticates via the same JWT tokens as the REST API
- API access requires explicit opt-in on your BoomTax account

## License

Proprietary. Copyright BoomTax.
