# Architect Knowledge MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that provides cloud architecture guidance from a curated knowledge library. Use it with Claude Desktop, Claude Code, Cursor, or any MCP-compatible client to get specific, checklist-driven architecture advice.

## What's in the knowledge library?

- **330+ curated files** covering cloud architecture best practices
- **Providers:** AWS, Azure, GCP, Kubernetes, VMware, Nutanix, Cisco, Dell, HPE, NetApp, and 40+ more
- **Compliance:** HIPAA, PCI-DSS, SOC2, FedRAMP, GDPR, CCPA, CJIS, ITAR, and more
- **Patterns:** Microservices, hybrid cloud, edge computing, AI/ML infrastructure, migration patterns
- **Checklists:** Every item tagged `[Critical]`, `[Recommended]`, or `[Optional]`

The knowledge library is sourced from the public [ErikEvenson/architect](https://github.com/ErikEvenson/architect) repository. No client data, project files, or private content is included.

## Setup

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### Claude Code

Add to your Claude Code settings:

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

## How it works

1. On first run, fetches knowledge files from the public GitHub repo
2. Caches files locally in `~/.cache/architect-knowledge-mcp/`
3. On subsequent runs, checks if the cache is fresh (same commit SHA) — skips download if so
4. Indexes all files using lightweight text search (BM25) for instant startup
5. Exposes three MCP tools for searching, browsing, and reading

No embedding models, no GPUs, no external databases. The package is <5MB and starts instantly after initial cache.

## Data safety

- Only reads from the public `knowledge/` directory in the GitHub repo
- Never accesses client data, project uploads, or database content
- Runs entirely on your machine — no data sent anywhere except to the LLM you're already using
- No API keys required (optional `GITHUB_TOKEN` env var to avoid rate limits)

## License

MIT
