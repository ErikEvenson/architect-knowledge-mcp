#!/usr/bin/env node

/**
 * MCP server for the Architect knowledge library.
 *
 * Provides cloud architecture checklists, vendor guidance, compliance
 * frameworks, and design patterns via the Model Context Protocol.
 *
 * Data source: Public knowledge files from github.com/ErikEvenson/architect
 * Only indexes the knowledge/ directory — never includes client data,
 * project uploads, or database content.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchKnowledgeFiles } from "./fetcher.js";
import type { KnowledgeFile } from "./fetcher.js";
import { parseAllFiles, buildCategoryTree } from "./parser.js";
import { KnowledgeSearch } from "./search.js";

// Global state
let knowledgeFiles: KnowledgeFile[] = [];
let searchEngine: KnowledgeSearch | null = null;

async function initializeKnowledge(): Promise<void> {
  knowledgeFiles = await fetchKnowledgeFiles();
  const chunks = parseAllFiles(knowledgeFiles);
  searchEngine = new KnowledgeSearch();
  searchEngine.buildIndex(chunks);
  console.error(
    `Indexed ${searchEngine.chunkCount} chunks from ${knowledgeFiles.length} knowledge files`,
  );
}

// Create MCP server
const server = new McpServer({
  name: "architect-knowledge",
  version: "0.1.0",
});

// Tool: search_knowledge
server.registerTool(
  "search_knowledge",
  {
    description:
      "Search the cloud architecture knowledge library for checklists, vendor guidance, compliance requirements, and design patterns. " +
      "Returns ranked results from curated knowledge files covering AWS, Azure, GCP, Kubernetes, VMware, Nutanix, and 40+ other providers, " +
      "plus compliance frameworks (HIPAA, PCI-DSS, SOC2, FedRAMP, etc.), architecture patterns, and failure modes.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Search query — use natural language like 'VMware to Nutanix migration checklist' or 'HIPAA encryption requirements'",
        ),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of results to return (default: 20)"),
      priority_filter: z
        .enum(["critical", "recommended", "optional"])
        .optional()
        .describe(
          "Filter results by priority level — 'critical' for must-have items, 'recommended' for should-have, 'optional' for nice-to-have",
        ),
      file_filter: z
        .string()
        .optional()
        .describe(
          "Filter results to a specific provider or category, e.g. 'aws', 'compliance/hipaa', 'patterns/microservices'",
        ),
    },
  },
  async ({ query, top_k, priority_filter, file_filter }) => {
    if (!searchEngine) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Knowledge library is still loading. Please try again in a moment.",
          },
        ],
      };
    }

    const results = searchEngine.search(query, {
      topK: top_k ?? 20,
      priorityFilter: priority_filter as
        | "critical"
        | "recommended"
        | "optional"
        | undefined,
      fileFilter: file_filter,
    });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No results found for "${query}". Try broader terms or check available categories with list_categories.`,
          },
        ],
      };
    }

    const formatted = results
      .map((r, i) => {
        const priorityTag = r.priority ? ` [${r.priority.toUpperCase()}]` : "";
        const checklistPrefix = r.checklistItem ? "☐ " : "";
        return [
          `### ${i + 1}. ${r.sourceFile} — ${r.section}${priorityTag}`,
          `${checklistPrefix}${r.content}`,
          "",
        ].join("\n");
      })
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} results for "${query}":\n\n${formatted}`,
        },
      ],
    };
  },
);

// Tool: list_categories
server.registerTool(
  "list_categories",
  {
    description:
      "Browse the knowledge library structure. Shows all available categories " +
      "and files organized by provider, pattern, compliance framework, etc. " +
      "Use this to discover what knowledge is available before searching.",
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe(
          "Filter to a specific top-level category: 'general', 'providers', 'patterns', 'compliance', 'frameworks', or 'failures'. " +
            "Or a specific provider like 'providers/aws'. Omit to see all categories.",
        ),
    },
  },
  async ({ category }) => {
    if (knowledgeFiles.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Knowledge library is still loading. Please try again in a moment.",
          },
        ],
      };
    }

    const tree = buildCategoryTree(knowledgeFiles);

    let output: string;
    if (category) {
      const filter = category.toLowerCase();
      const filtered: Record<string, string[]> = {};
      for (const [key, files] of Object.entries(tree)) {
        if (key.toLowerCase().startsWith(filter)) {
          filtered[key] = files;
        }
      }

      if (Object.keys(filtered).length === 0) {
        output = `No category matching "${category}". Available top-level categories: ${[...new Set(Object.keys(tree).map((k) => k.split("/")[0]))].join(", ")}`;
      } else {
        const lines: string[] = [];
        for (const [key, files] of Object.entries(filtered)) {
          lines.push(`\n## ${key} (${files.length} files)`);
          for (const file of files) {
            lines.push(`- ${file}`);
          }
        }
        output = lines.join("\n");
      }
    } else {
      // Summary view
      const topLevel: Record<string, number> = {};
      for (const [key, files] of Object.entries(tree)) {
        const top = key.split("/")[0];
        topLevel[top] = (topLevel[top] ?? 0) + files.length;
      }

      const lines = [
        `# Architect Knowledge Library (${knowledgeFiles.length} files)\n`,
      ];
      for (const [cat, count] of Object.entries(topLevel).sort()) {
        lines.push(`- **${cat}/** — ${count} files`);
      }
      lines.push(
        "\nUse `list_categories` with a category parameter (e.g. 'providers/aws') to see specific files.",
      );
      output = lines.join("\n");
    }

    return {
      content: [{ type: "text" as const, text: output }],
    };
  },
);

// Tool: read_file
server.registerTool(
  "read_file",
  {
    description:
      "Read a specific knowledge file in full. Use this after search_knowledge " +
      "identifies a relevant file and you need the complete content including all " +
      "checklist items, ADR triggers, and reference links.",
    inputSchema: {
      path: z
        .string()
        .describe(
          "Path to the knowledge file relative to the knowledge/ directory, " +
            "e.g. 'providers/aws/containers.md' or 'compliance/hipaa.md'",
        ),
    },
  },
  async ({ path }) => {
    const file = knowledgeFiles.find(
      (f) => f.path === path || f.path === path.replace(/^knowledge\//, ""),
    );

    if (!file) {
      // Suggest similar files
      const searchTerm = path.split("/").pop()?.replace(".md", "") ?? path;
      const similar = knowledgeFiles
        .filter((f) => f.path.toLowerCase().includes(searchTerm.toLowerCase()))
        .slice(0, 5)
        .map((f) => f.path);

      let msg = `File not found: ${path}`;
      if (similar.length > 0) {
        msg += `\n\nDid you mean one of these?\n${similar.map((s) => `- ${s}`).join("\n")}`;
      }

      return {
        content: [{ type: "text" as const, text: msg }],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `# ${file.path}\n\n${file.content}`,
        },
      ],
    };
  },
);

// Start the server
async function main(): Promise<void> {
  // Initialize knowledge in background so server starts quickly
  const initPromise = initializeKnowledge().catch((err) => {
    console.error(`Failed to initialize knowledge library: ${err}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Architect Knowledge MCP server started");

  // Wait for initialization to complete
  await initPromise;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
