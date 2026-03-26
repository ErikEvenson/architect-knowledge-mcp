/**
 * Lightweight search engine using MiniSearch (BM25-based text search).
 * Indexes parsed knowledge chunks for fast keyword and fuzzy search.
 */

import MiniSearch from "minisearch";
import type { ParsedChunk } from "./parser.js";

export interface SearchResult {
  sourceFile: string;
  section: string;
  checklistItem: string | null;
  priority: string | null;
  content: string;
  score: number;
}

export class KnowledgeSearch {
  private index: MiniSearch;
  private chunks: ParsedChunk[];

  constructor() {
    this.chunks = [];
    this.index = new MiniSearch({
      fields: ["content", "sourceFile", "section", "priority"],
      storeFields: ["sourceFile", "section", "checklistItem", "priority", "content"],
      searchOptions: {
        boost: { content: 2, section: 1.5, sourceFile: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
      tokenize: (text) => {
        // Split on whitespace, hyphens, underscores, slashes, and dots
        return text
          .toLowerCase()
          .split(/[\s\-_/.,:;()\[\]{}|]+/)
          .filter((t) => t.length > 1);
      },
    });
  }

  buildIndex(chunks: ParsedChunk[]): void {
    this.chunks = chunks;
    const documents = chunks.map((chunk, i) => ({
      id: i,
      content: chunk.content,
      sourceFile: chunk.sourceFile,
      section: chunk.section,
      checklistItem: chunk.checklistItem,
      priority: chunk.priority,
    }));
    this.index.addAll(documents);
  }

  search(
    query: string,
    options?: {
      topK?: number;
      priorityFilter?: "critical" | "recommended" | "optional";
      fileFilter?: string;
    },
  ): SearchResult[] {
    const topK = options?.topK ?? 20;

    let results = this.index.search(query, {
      boost: { content: 2, section: 1.5, sourceFile: 1 },
      fuzzy: 0.2,
      prefix: true,
    });

    // Apply priority filter
    if (options?.priorityFilter) {
      results = results.filter(
        (r) => r.priority === options.priorityFilter,
      );
    }

    // Apply file filter (substring match on source path)
    if (options?.fileFilter) {
      const filter = options.fileFilter.toLowerCase();
      results = results.filter(
        (r) => (r.sourceFile as string).toLowerCase().includes(filter),
      );
    }

    return results.slice(0, topK).map((r) => ({
      sourceFile: r.sourceFile as string,
      section: r.section as string,
      checklistItem: (r.checklistItem as string | null) ?? null,
      priority: (r.priority as string | null) ?? null,
      content: r.content as string,
      score: Math.round(r.score * 100) / 100,
    }));
  }

  get chunkCount(): number {
    return this.chunks.length;
  }
}
