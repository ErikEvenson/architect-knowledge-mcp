/**
 * Parses knowledge library markdown files into structured chunks for indexing.
 * Ported from the backend's knowledge_parser.py.
 */

export interface ParsedChunk {
  sourceFile: string;
  section: string;
  checklistItem: string | null;
  priority: "critical" | "recommended" | "optional" | null;
  content: string;
}

const CHECKLIST_PATTERN =
  /^- \[[ x]\] \*\*\[(Critical|Recommended|Optional)\]\*\*\s+(.+)/i;

const HEADING_PATTERN = /^(#{1,6})\s+(.+)/;

export function parseKnowledgeFile(
  relativePath: string,
  content: string,
): ParsedChunk[] {
  const lines = content.split("\n");
  const chunks: ParsedChunk[] = [];

  let currentSection = "Untitled";
  let sectionContentLines: string[] = [];

  function flushSection(): void {
    if (sectionContentLines.length > 0) {
      const text = sectionContentLines.join("\n").trim();
      if (
        text &&
        currentSection !== "Untitled" &&
        currentSection !== "Checklist" &&
        currentSection !== "See Also" &&
        currentSection !== "Reference Links"
      ) {
        chunks.push({
          sourceFile: relativePath,
          section: currentSection,
          checklistItem: null,
          priority: null,
          content: text,
        });
      }
    }
  }

  for (const line of lines) {
    // Check for heading
    const headingMatch = HEADING_PATTERN.exec(line);
    if (headingMatch) {
      flushSection();
      sectionContentLines = [];
      currentSection = headingMatch[2].trim();
      continue;
    }

    // Check for checklist item
    const checklistMatch = CHECKLIST_PATTERN.exec(line);
    if (checklistMatch) {
      const priority = checklistMatch[1].toLowerCase() as
        | "critical"
        | "recommended"
        | "optional";
      const itemText = checklistMatch[2].trim();
      chunks.push({
        sourceFile: relativePath,
        section: currentSection,
        checklistItem: itemText,
        priority,
        content: itemText,
      });
      continue;
    }

    // Accumulate non-checklist content
    sectionContentLines.push(line);
  }

  // Flush final section
  flushSection();

  return chunks;
}

export function parseAllFiles(
  files: Array<{ path: string; content: string }>,
): ParsedChunk[] {
  const allChunks: ParsedChunk[] = [];
  for (const file of files) {
    allChunks.push(...parseKnowledgeFile(file.path, file.content));
  }
  return allChunks;
}

/**
 * Extract the category from a file path.
 * e.g. "providers/aws/containers.md" -> "providers/aws"
 *      "compliance/hipaa.md" -> "compliance"
 *      "patterns/microservices.md" -> "patterns"
 */
export function extractCategory(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length >= 3) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

/**
 * Build a structured tree of knowledge categories.
 */
export function buildCategoryTree(
  files: Array<{ path: string }>,
): Record<string, string[]> {
  const tree: Record<string, string[]> = {};
  for (const file of files) {
    const category = extractCategory(file.path);
    if (!tree[category]) {
      tree[category] = [];
    }
    tree[category].push(file.path);
  }
  // Sort categories and files within each
  const sorted: Record<string, string[]> = {};
  for (const key of Object.keys(tree).sort()) {
    sorted[key] = tree[key].sort();
  }
  return sorted;
}
