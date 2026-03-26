/**
 * Fetches knowledge files from the public GitHub repository.
 * Only reads from the knowledge/ directory — never touches client data,
 * uploads, or any other content.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_OWNER = "ErikEvenson";
const REPO_NAME = "architect";
const KNOWLEDGE_PATH = "knowledge";
const GITHUB_API = "https://api.github.com";

// Allowlisted directories within knowledge/ — only these are fetched
const ALLOWED_DIRS = [
  "general",
  "providers",
  "patterns",
  "compliance",
  "frameworks",
  "failures",
];

// Files to skip
const SKIP_FILES = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "WORKFLOW.md",
  "references.md",
]);

export interface KnowledgeFile {
  path: string; // Relative to knowledge/, e.g. "providers/aws/containers.md"
  content: string;
}

interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
  url: string;
}

interface CacheManifest {
  commitSha: string;
  fetchedAt: string;
  fileCount: number;
}

function getCacheDir(): string {
  const dir = join(homedir(), ".cache", "architect-knowledge-mcp");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCacheManifestPath(): string {
  return join(getCacheDir(), "manifest.json");
}

function getCacheFilePath(relativePath: string): string {
  const hash = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  return join(getCacheDir(), `${hash}.md`);
}

function readCacheManifest(): CacheManifest | null {
  const path = getCacheManifestPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeCacheManifest(manifest: CacheManifest): void {
  writeFileSync(getCacheManifestPath(), JSON.stringify(manifest, null, 2));
}

function isAllowedPath(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  if (SKIP_FILES.has(fileName)) return false;
  if (!filePath.endsWith(".md")) return false;

  // Must be in one of the allowlisted directories
  const topDir = filePath.split("/")[0];
  return ALLOWED_DIRS.includes(topDir);
}

async function githubFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "architect-knowledge-mcp",
  };

  // Use GITHUB_TOKEN if available (for rate limiting)
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(url, { headers });
}

async function getLatestCommitSha(): Promise<string> {
  const resp = await githubFetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits/master?per_page=1`
  );
  if (!resp.ok) {
    throw new Error(`Failed to get latest commit: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as { sha: string };
  return data.sha;
}

async function fetchFileContent(filePath: string): Promise<string> {
  const resp = await githubFetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${KNOWLEDGE_PATH}/${filePath}`
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${filePath}: ${resp.status}`);
  }
  const data = (await resp.json()) as { content: string; encoding: string };
  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return data.content;
}

async function fetchTree(commitSha: string): Promise<GitHubTreeItem[]> {
  const resp = await githubFetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${commitSha}?recursive=1`
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch tree: ${resp.status}`);
  }
  const data = (await resp.json()) as { tree: GitHubTreeItem[] };
  return data.tree;
}

export async function fetchKnowledgeFiles(): Promise<KnowledgeFile[]> {
  const cacheDir = getCacheDir();
  const manifest = readCacheManifest();

  // Check if cache is fresh
  let latestSha: string;
  try {
    latestSha = await getLatestCommitSha();
  } catch {
    // Offline or rate-limited — use cache if available
    if (manifest) {
      console.error("GitHub API unavailable, using cached knowledge files");
      return loadFromCache();
    }
    throw new Error("Cannot fetch knowledge files and no cache available");
  }

  if (manifest && manifest.commitSha === latestSha) {
    console.error(`Knowledge cache is fresh (${latestSha.slice(0, 7)}), using cached files`);
    return loadFromCache();
  }

  console.error(`Fetching knowledge files from GitHub (${latestSha.slice(0, 7)})...`);

  // Get full tree to find all knowledge files
  const tree = await fetchTree(latestSha);
  const knowledgeFiles = tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path.startsWith(`${KNOWLEDGE_PATH}/`) &&
      isAllowedPath(item.path.slice(KNOWLEDGE_PATH.length + 1))
  );

  const files: KnowledgeFile[] = [];
  const batchSize = 10;

  for (let i = 0; i < knowledgeFiles.length; i += batchSize) {
    const batch = knowledgeFiles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (item) => {
        const relativePath = item.path.slice(KNOWLEDGE_PATH.length + 1);
        try {
          const content = await fetchFileContent(relativePath);
          return { path: relativePath, content };
        } catch (err) {
          console.error(`Warning: failed to fetch ${relativePath}: ${err}`);
          return null;
        }
      })
    );

    for (const result of results) {
      if (result) {
        files.push(result);
        // Cache each file
        const cachePath = getCacheFilePath(result.path);
        writeFileSync(cachePath, JSON.stringify(result));
      }
    }
  }

  // Write cache manifest
  writeCacheManifest({
    commitSha: latestSha,
    fetchedAt: new Date().toISOString(),
    fileCount: files.length,
  });

  // Write file index for cache loading
  const index = files.map((f) => f.path);
  writeFileSync(join(cacheDir, "index.json"), JSON.stringify(index));

  console.error(`Cached ${files.length} knowledge files`);
  return files;
}

function loadFromCache(): KnowledgeFile[] {
  const cacheDir = getCacheDir();
  const indexPath = join(cacheDir, "index.json");
  if (!existsSync(indexPath)) return [];

  const paths: string[] = JSON.parse(readFileSync(indexPath, "utf-8"));
  const files: KnowledgeFile[] = [];

  for (const filePath of paths) {
    const cachePath = getCacheFilePath(filePath);
    if (existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
        files.push(cached);
      } catch {
        // Skip corrupted cache entries
      }
    }
  }

  return files;
}
