# Architect Knowledge MCP Server

[![npm version](https://img.shields.io/npm/v/@eevenson/architect-knowledge-mcp)](https://www.npmjs.com/package/@eevenson/architect-knowledge-mcp)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that provides cloud architecture guidance from a curated knowledge library. Use it with Claude Desktop, Claude Code, Cursor, or any MCP-compatible client to get specific, checklist-driven architecture advice.

## What's in the knowledge library?

- **330+ curated files** covering cloud architecture best practices
- **Providers:** AWS, Azure, GCP, Kubernetes, VMware, Nutanix, Cisco, Dell, HPE, NetApp, Pure Storage, Snowflake, Databricks, Confluent/Kafka, MongoDB, Redis, Elasticsearch, CrowdStrike, Okta, GitLab, ArgoCD, and 40+ more
- **Compliance:** HIPAA, PCI-DSS, SOC2, FedRAMP, GDPR, CCPA, CJIS, ITAR, ISO 27001, NIST/CMMC, and more
- **Patterns:** Microservices, hybrid cloud, edge computing, AI/ML infrastructure, application modernization, security operations, migration patterns
- **General:** Networking, compute, storage, identity, observability, disaster recovery, cost management, messaging, supply chain security, performance testing
- **Checklists:** Every item tagged `[Critical]`, `[Recommended]`, or `[Optional]`

The knowledge library is sourced from the public [ErikEvenson/architect](https://github.com/ErikEvenson/architect) repository. No client data, project files, or private content is included.

## Setup

### Claude Desktop

Add to your Claude Desktop config file (or use **Settings > Developer > Edit Config**):

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "architect-knowledge": {
      "command": "npx",
      "args": ["@eevenson/architect-knowledge-mcp"]
    }
  }
}
```

Restart Claude Desktop. A hammer icon will appear at the bottom of the chat input when the tools are available.

### Claude Code

Run this from the Claude Code prompt:

```
claude mcp add architect-knowledge -- npx @eevenson/architect-knowledge-mcp
```

Or add to your settings JSON:

```json
{
  "mcpServers": {
    "architect-knowledge": {
      "command": "npx",
      "args": ["@eevenson/architect-knowledge-mcp"]
    }
  }
}
```

### Other MCP Clients

Works with any MCP-compatible client including Cursor, Windsurf, Cline, and Continue. Consult your client's documentation for how to add MCP servers.

## Tools

### `search_knowledge`

Search the knowledge library for checklists, vendor guidance, and design patterns.

**Parameters:**
- `query` (required) — Natural language search, e.g. "VMware to Nutanix migration checklist"
- `top_k` (optional) — Max results, 1-50, default 20
- `priority_filter` (optional) — `"critical"`, `"recommended"`, or `"optional"`
- `file_filter` (optional) — Filter to a provider or category, e.g. `"aws"`, `"compliance/hipaa"`

### `list_categories`

Browse available knowledge categories and files.

**Parameters:**
- `category` (optional) — Filter to a category, e.g. `"providers/aws"`, `"compliance"`

### `read_file`

Read a complete knowledge file.

**Parameters:**
- `path` (required) — File path, e.g. `"providers/aws/containers.md"`

## Example Usage

Once connected, just ask architecture questions naturally:

- "What are the critical checklist items for HIPAA compliance?"
- "Search for Kubernetes storage best practices"
- "What should I consider for a VMware to Nutanix migration?"
- "Show me the AWS containers checklist"
- "What compliance frameworks cover encryption requirements?"

Claude will automatically call the MCP tools to ground its answers in the knowledge library's curated checklists.

## How It Works

1. On first run, fetches knowledge files from the public GitHub repo
2. Caches files locally in `~/.cache/architect-knowledge-mcp/`
3. On subsequent runs, checks if the cache is fresh (same commit SHA) — skips download if so
4. Indexes all files using lightweight text search (BM25) for instant startup
5. Exposes three MCP tools for searching, browsing, and reading

No embedding models, no GPUs, no external databases. The package is ~15KB and starts instantly after initial cache.

## Data Safety

- Only reads from the public `knowledge/` directory in the GitHub repo
- Allowlisted directories only: `general`, `providers`, `patterns`, `compliance`, `frameworks`, `failures`
- Never accesses client data, project uploads, or database content
- Runs entirely on your machine — no data sent anywhere except to the LLM you're already using
- No API keys required (optional `GITHUB_TOKEN` env var to avoid rate limits)

## Development

```bash
git clone https://github.com/ErikEvenson/architect-knowledge-mcp.git
cd architect-knowledge-mcp
npm install
npm run build
npm test
```

## Troubleshooting

**Tools not showing in Claude Desktop?**
- Restart Claude Desktop after editing the config
- Check logs at `~/Library/Logs/Claude/mcp-server-architect-knowledge.log` (macOS)
- Verify Node.js 18+ is installed: `node --version`

**Slow first startup?**
- The first run fetches ~330 files from GitHub (takes 15-30 seconds)
- Subsequent runs use the local cache and start instantly

**GitHub rate limiting?**
- Set `GITHUB_TOKEN` environment variable with a personal access token (no scopes needed for public repos)

## License

MIT
