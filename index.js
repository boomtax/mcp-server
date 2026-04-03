#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- Configuration ---

const API_URL = (process.env.BOOMTAX_API_URL || "https://api.boomtax.com").replace(
  /\/$/,
  ""
);
const USERNAME = process.env.BOOMTAX_API_USERNAME;
const PASSWORD = process.env.BOOMTAX_API_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error(
    "Missing required environment variables: BOOMTAX_API_USERNAME, BOOMTAX_API_PASSWORD"
  );
  process.exit(1);
}

// --- Token management ---

let accessToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  const res = await fetch(`${API_URL}/Token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new Error(
        "API access is not enabled on this account. Contact BoomTax support at support@boomtax.com."
      );
    }
    throw new Error(`Authentication failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  const expiresIn = data.expires_in
    ? data.expires_in * 1000
    : 23 * 60 * 60 * 1000;
  tokenExpiresAt = Date.now() + expiresIn - 60_000;
  return accessToken;
}

// --- API client ---

async function api(path, { method = "GET", body, query, retry = true } = {}) {
  const token = await getToken();
  const url = new URL(`${API_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  // Auto-refresh token on 401 (retry once)
  if (res.status === 401 && retry) {
    accessToken = null;
    return api(path, { method, body, query, retry: false });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BoomTax API ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// --- Helpers ---

const TIN_FIELD_RE = /^(tin|ssn|ein|taxId|federalId|identificationNumber)$/i;

function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (TIN_FIELD_RE.test(key) && typeof value === "string") {
        result[key] = maskTin(value);
      } else {
        result[key] = sanitize(value);
      }
    }
    return result;
  }
  return obj;
}

function maskTin(tin) {
  if (!tin || tin.length < 4) return "***";
  return "***-**-" + tin.slice(-4);
}

function json(data) {
  return [{ type: "text", text: JSON.stringify(sanitize(data), null, 2) }];
}

async function getFiling(filingId) {
  const result = await api("/Filing", { query: { id: filingId } });
  // GET /Filing?id=xxx returns a single-item array
  const filing = Array.isArray(result) ? result[0] : result;
  return filing || null;
}

// Cache filing types for the process lifetime (changes ~once per year)
let cachedFilingTypes = null;

async function getFilingTypes() {
  if (!cachedFilingTypes) cachedFilingTypes = await api("/FilingType");
  return cachedFilingTypes;
}

function paginate(arr, page, pageSize) {
  page = Math.max(1, page);
  pageSize = Math.min(200, Math.max(1, pageSize));
  const start = (page - 1) * pageSize;
  return {
    totalCount: arr.length,
    page,
    pageSize,
    items: arr.slice(start, start + pageSize),
  };
}

// --- MCP Server ---

const server = new McpServer({ name: "boomtax", version: "1.0.0" });

// Tool 1: list_filings
server.tool(
  "list_filings",
  "List tax filings with optional filters. Returns paginated results with filing name, status, form type, and dates.",
  {
    taxYear: z.number().optional().describe("Filter by tax year (e.g. 2025)"),
    formType: z
      .string()
      .optional()
      .describe("Filter by form type name (e.g. '1099-NEC', '1099-MISC', 'W-2')"),
    status: z
      .string()
      .optional()
      .describe("Filter by status (e.g. 'Accepted', 'Rejected')"),
    page: z.number().default(1).describe("Page number (1-based, default 1)"),
    pageSize: z.number().default(50).describe("Page size (default 50, max 200)"),
  },
  async ({ taxYear, formType, status, page, pageSize }) => {
    const allFilings = await api("/Filing");
    const filingTypes = await getFilingTypes();
    const typeMap = Object.fromEntries(filingTypes.map((t) => [t.id, t]));

    let filings = allFilings.map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      formType: typeMap[f.filingTypeId]?.name ?? "Unknown",
      taxYear: typeMap[f.filingTypeId]?.taxYear ?? null,
      formCount: f.formIds?.length ?? 0,
      isEfiled: f.isEfiled,
      dateCreated: f.dateCreated,
    }));

    if (taxYear) filings = filings.filter((f) => f.taxYear === taxYear);
    if (formType)
      filings = filings.filter((f) =>
        f.formType.toLowerCase().includes(formType.toLowerCase())
      );
    if (status)
      filings = filings.filter((f) =>
        (f.status || "").toLowerCase().includes(status.toLowerCase())
      );

    filings.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));
    const result = paginate(filings, page, pageSize);
    return {
      content: json({
        totalCount: result.totalCount,
        page: result.page,
        pageSize: result.pageSize,
        filings: result.items,
      }),
    };
  }
);

// Tool 2: get_filing_details
server.tool(
  "get_filing_details",
  "Get detailed information about a specific filing including payer summary and latest e-file status.",
  {
    filingId: z.string().describe("Filing ID (GUID)"),
  },
  async ({ filingId }) => {
    const filing = await getFiling(filingId);
    if (!filing) return { content: json({ error: "Filing not found." }) };

    // Get e-file status
    let latestEfile = null;
    try {
      const requests = await api("/EfileRequests", { query: { filingId } });
      if (requests?.length > 0) {
        const latest = requests.sort(
          (a, b) => new Date(b.dateStarted) - new Date(a.dateStarted)
        )[0];
        latestEfile = {
          requestDate: latest.dateStarted,
          uploadDate: latest.dateCompleted,
          isComplete: latest.isComplete,
          efileResponseId: latest.efileResponseId,
        };
        if (latest.efileResponseId) {
          try {
            const resp = await api("/EfileResponse", {
              query: { id: latest.efileResponseId },
            });
            latestEfile.responseStatus = resp?.status;
            latestEfile.isError = resp?.isError ?? false;
          } catch (e) {
            console.error(`Failed to fetch efile response: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to fetch efile requests for ${filingId}: ${e.message}`);
    }

    const filingTypes = await getFilingTypes();
    const type = filingTypes.find((t) => t.id === filing.filingTypeId);

    return {
      content: json({
        id: filing.id,
        name: filing.name,
        status: filing.status,
        formType: type?.name,
        taxYear: type?.taxYear,
        isEditable: filing.isEditable,
        isEfiled: filing.isEfiled,
        dateCreated: filing.dateCreated,
        formCount: filing.formIds?.length ?? 0,
        latestEfile,
      }),
    };
  }
);

// Tool 3: get_filing_summary
server.tool(
  "get_filing_summary",
  "Get aggregate filing counts grouped by status and form type for a tax year.",
  {
    taxYear: z
      .number()
      .optional()
      .describe("Tax year to summarize (e.g. 2025). If omitted, summarizes all years."),
  },
  async ({ taxYear }) => {
    const allFilings = await api("/Filing");
    const filingTypes = await getFilingTypes();
    const typeMap = Object.fromEntries(filingTypes.map((t) => [t.id, t]));

    let filings = allFilings.map((f) => ({
      formType: typeMap[f.filingTypeId]?.name ?? "Unknown",
      taxYear: typeMap[f.filingTypeId]?.taxYear ?? null,
      status: f.status || "No Status",
      isEfiled: f.isEfiled,
      formCount: f.formIds?.length ?? 0,
    }));

    if (taxYear) filings = filings.filter((f) => f.taxYear === taxYear);

    const byFormType = Object.values(
      filings.reduce((acc, f) => {
        const key = `${f.formType}|${f.taxYear}`;
        if (!acc[key])
          acc[key] = {
            formType: f.formType,
            taxYear: f.taxYear,
            filingCount: 0,
            totalForms: 0,
            efiledCount: 0,
          };
        acc[key].filingCount++;
        acc[key].totalForms += f.formCount;
        if (f.isEfiled) acc[key].efiledCount++;
        return acc;
      }, {})
    );

    const byStatus = Object.entries(
      filings.reduce((acc, f) => {
        acc[f.status] = (acc[f.status] || 0) + 1;
        return acc;
      }, {})
    )
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    return {
      content: json({
        totalFilings: filings.length,
        totalForms: filings.reduce((sum, f) => sum + f.formCount, 0),
        byFormType,
        byStatus,
      }),
    };
  }
);

// Tool 4: get_form
server.tool(
  "get_form",
  "Get a specific form's metadata. Provide filingId for fast lookup, or omit it to scan all filings (slower).",
  {
    formId: z.string().describe("Form ID (GUID)"),
    filingId: z
      .string()
      .optional()
      .describe("Filing ID (GUID) — strongly recommended for fast lookup. Use list_filing_forms to find form IDs."),
  },
  async ({ formId, filingId }) => {
    let filing = null;

    if (filingId) {
      filing = await getFiling(filingId);
      if (filing && !filing.formIds?.includes(formId)) filing = null;
    }

    if (!filing) {
      const allFilings = await api("/Filing");
      for (const f of allFilings) {
        const detail = await getFiling(f.id);
        if (detail?.formIds?.includes(formId)) {
          filing = detail;
          break;
        }
      }
    }

    if (!filing) return { content: json({ error: "Form not found." }) };

    const filingTypes = await getFilingTypes();
    const type = filingTypes.find((t) => t.id === filing.filingTypeId);

    return {
      content: json({
        id: formId,
        filingId: filing.id,
        filingName: filing.name,
        formType: type?.name,
        filingStatus: filing.status,
        isEfiled: filing.isEfiled,
        isEditable: filing.isEditable,
      }),
    };
  }
);

// Tool 5: list_filing_forms
server.tool(
  "list_filing_forms",
  "List all forms belonging to a specific filing with their IDs.",
  {
    filingId: z.string().describe("Filing ID (GUID)"),
    page: z.number().default(1).describe("Page number (1-based, default 1)"),
    pageSize: z.number().default(50).describe("Page size (default 50, max 200)"),
  },
  async ({ filingId, page, pageSize }) => {
    const filing = await getFiling(filingId);
    if (!filing) return { content: json({ error: "Filing not found." }) };

    const formIds = (filing.formIds || []).map((id) => ({ id }));
    const result = paginate(formIds, page, pageSize);

    return {
      content: json({
        filingId: filing.id,
        filingName: filing.name,
        totalCount: result.totalCount,
        page: result.page,
        pageSize: result.pageSize,
        forms: result.items,
      }),
    };
  }
);

// Tool 6: get_efile_status
server.tool(
  "get_efile_status",
  "Get the e-file status for a filing including the full request/response timeline.",
  {
    filingId: z.string().describe("Filing ID (GUID)"),
  },
  async ({ filingId }) => {
    const filing = await getFiling(filingId);
    if (!filing) return { content: json({ error: "Filing not found." }) };

    let requests = [];
    try {
      const efileRequests = await api("/EfileRequests", { query: { filingId } });
      requests = await Promise.all(
        (efileRequests || []).map(async (er) => {
          const entry = {
            id: er.id,
            requestDate: er.dateStarted,
            uploadDate: er.dateCompleted,
            isComplete: er.isComplete,
          };
          if (er.efileResponseId) {
            try {
              const resp = await api("/EfileResponse", {
                query: { id: er.efileResponseId },
              });
              entry.response = {
                id: resp.id,
                status: resp.status,
                isError: resp.isError,
              };
            } catch (e) {
              console.error(`Failed to fetch efile response: ${e.message}`);
            }
          }
          return entry;
        })
      );
    } catch (e) {
      console.error(`Failed to fetch efile requests for ${filingId}: ${e.message}`);
    }

    requests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

    return {
      content: json({
        filingId: filing.id,
        filingName: filing.name,
        isEfiled: filing.isEfiled,
        overallStatus: filing.status,
        requests,
      }),
    };
  }
);

// Tool 7: get_efile_errors
server.tool(
  "get_efile_errors",
  "Get e-file errors for a filing including header-level and per-form errors with error codes and messages.",
  {
    filingId: z.string().describe("Filing ID (GUID)"),
  },
  async ({ filingId }) => {
    try {
      const errors = await api(`/FilingErrors/${filingId}`);
      return { content: json(errors) };
    } catch (e) {
      if (e.message.includes("404")) {
        return {
          content: json({
            filingId,
            message: "No e-file errors found for this filing.",
            errors: [],
          }),
        };
      }
      throw e;
    }
  }
);

// Tool 8: list_payers
server.tool(
  "list_payers",
  "List payers (issuers) across your filings.",
  {
    search: z.string().optional().describe("Search by payer name"),
    page: z.number().default(1).describe("Page number (1-based, default 1)"),
    pageSize: z.number().default(50).describe("Page size (default 50, max 200)"),
  },
  async ({ search, page, pageSize }) => {
    const allFilings = await api("/Filing");
    const filingTypes = await getFilingTypes();
    const typeMap = Object.fromEntries(filingTypes.map((t) => [t.id, t]));

    let payers = allFilings.map((f) => ({
      filingId: f.id,
      name: f.name,
      formType: typeMap[f.filingTypeId]?.name ?? "Unknown",
      taxYear: typeMap[f.filingTypeId]?.taxYear,
    }));

    if (search) {
      const s = search.toLowerCase();
      payers = payers.filter((p) => p.name?.toLowerCase().includes(s));
    }

    payers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const result = paginate(payers, page, pageSize);

    return {
      content: json({
        totalCount: result.totalCount,
        page: result.page,
        pageSize: result.pageSize,
        payers: result.items,
      }),
    };
  }
);

// Tool 9: get_payer
server.tool(
  "get_payer",
  "Get payer (issuer) name and filing info for a specific filing.",
  {
    filingId: z.string().describe("Filing ID (GUID)"),
  },
  async ({ filingId }) => {
    const filing = await getFiling(filingId);
    if (!filing)
      return { content: json({ error: "Filing not found or access denied." }) };

    return {
      content: json({
        filingId: filing.id,
        name: filing.name,
        status: filing.status,
        isEfiled: filing.isEfiled,
      }),
    };
  }
);

// Tool 10: list_filing_types
server.tool(
  "list_filing_types",
  "List all filing types supported by BoomTax with their tax year and e-file availability.",
  {},
  async () => {
    const types = await getFilingTypes();
    return {
      content: json({
        types: types.map((t) => ({
          name: t.name,
          description: t.description,
          taxYear: t.taxYear,
        })),
      }),
    };
  }
);

// --- Start ---

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (e) {
  console.error("Failed to start MCP server:", e.message);
  process.exit(1);
}
