/**
 * Fetches knowledge files from the public GitHub repository.
 * Only reads from the knowledge/ directory — never touches client data,
 * uploads, or any other content.
 *
 * Fetch strategy:
 * - Uses raw.githubusercontent.com (no API rate limit) for file content,
 *   so anonymous users can complete a full fetch without GITHUB_TOKEN.
 * - Uses the GitHub API only for two calls per refresh: latest commit SHA
 *   and the recursive tree listing. Both fit comfortably in the anonymous
 *   60 req/hour quota.
 *
 * Cache safety:
 * - All files are downloaded into memory first; the on-disk cache and
 *   manifest are only updated if every file fetch succeeded.
 * - 404 on a file is treated as "deleted upstream" — the file is dropped
 *   from the result set but the fetch is not aborted.
 * - 429 / 5xx / network errors abort the entire fetch and leave the
 *   previous cache untouched, so the next startup retries cleanly.
 * - The manifest is written via a temp file + rename so the freshness
 *   check never sees a half-written manifest.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_OWNER = "ErikEvenson";
const REPO_NAME = "architect";
const REPO_BRANCH = "master";
const KNOWLEDGE_PATH = "knowledge";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

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

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
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
  const hash = createHash("sha256")
    .update(relativePath)
    .digest("hex")
    .slice(0, 16);
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

function writeCacheManifestAtomic(manifest: CacheManifest): void {
  // Write to a temp file and rename so a partial write never poisons the
  // freshness check on subsequent startups.
  const finalPath = getCacheManifestPath();
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  renameSync(tmpPath, finalPath);
}

function isAllowedPath(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  if (SKIP_FILES.has(fileName)) return false;
  if (!filePath.endsWith(".md")) return false;

  // Must be in one of the allowlisted directories
  const topDir = filePath.split("/")[0];
  return ALLOWED_DIRS.includes(topDir);
}

async function githubApiFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "architect-knowledge-mcp",
  };

  // GITHUB_TOKEN is optional — used only for the 2 API calls per refresh
  // (latest commit SHA, recursive tree). Raw file fetches do not need it.
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(url, { headers });
}

async function rawFetch(commitSha: string, relativePath: string): Promise<Response> {
  const url = `${GITHUB_RAW}/${REPO_OWNER}/${REPO_NAME}/${commitSha}/${KNOWLEDGE_PATH}/${relativePath}`;
  return fetch(url, {
    headers: { "User-Agent": "architect-knowledge-mcp" },
  });
}

async function getLatestCommitSha(): Promise<string> {
  const resp = await githubApiFetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_BRANCH}?per_page=1`,
  );
  if (resp.status === 429 || resp.status === 403) {
    throw new RateLimitError(
      `GitHub API rate-limited fetching latest commit SHA (HTTP ${resp.status}). ` +
        `Set GITHUB_TOKEN to raise the limit.`,
    );
  }
  if (!resp.ok) {
    throw new Error(
      `Failed to get latest commit: ${resp.status} ${resp.statusText}`,
    );
  }
  const data = (await resp.json()) as { sha: string };
  return data.sha;
}

async function fetchTree(commitSha: string): Promise<GitHubTreeItem[]> {
  const resp = await githubApiFetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${commitSha}?recursive=1`,
  );
  if (resp.status === 429 || resp.status === 403) {
    throw new RateLimitError(
      `GitHub API rate-limited fetching tree (HTTP ${resp.status}). ` +
        `Set GITHUB_TOKEN to raise the limit.`,
    );
  }
  if (!resp.ok) {
    throw new Error(`Failed to fetch tree: ${resp.status}`);
  }
  const data = (await resp.json()) as { tree: GitHubTreeItem[] };
  return data.tree;
}

/**
 * Fetches a single file's raw content. Returns null when the file no
 * longer exists upstream (404). Throws on any other error so the caller
 * can abort the entire refresh.
 */
async function fetchFileContent(
  commitSha: string,
  relativePath: string,
): Promise<string | null> {
  const resp = await rawFetch(commitSha, relativePath);
  if (resp.status === 404) {
    // File was removed upstream — drop it from the result set but do not
    // abort the refresh.
    return null;
  }
  if (resp.status === 429) {
    // raw.githubusercontent.com is not normally rate-limited, but if it
    // ever returns 429 we surface it explicitly so we don't poison the cache.
    throw new RateLimitError(
      `raw.githubusercontent.com rate-limited fetching ${relativePath} (HTTP 429). ` +
        `Aborting refresh; previous cache will be reused on next startup.`,
    );
  }
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${relativePath}: ${resp.status} ${resp.statusText}`);
  }
  return await resp.text();
}

export async function fetchKnowledgeFiles(): Promise<KnowledgeFile[]> {
  const cacheDir = getCacheDir();
  const manifest = readCacheManifest();

  // Resolve the latest commit SHA. If GitHub API is unreachable or
  // rate-limited and we have a cache, fall back to it.
  let latestSha: string;
  try {
    latestSha = await getLatestCommitSha();
  } catch (err) {
    if (manifest) {
      console.error(
        `GitHub API unavailable (${(err as Error).message}), using cached knowledge files`,
      );
      return loadFromCache();
    }
    throw new Error(
      `Cannot fetch knowledge files and no cache available: ${(err as Error).message}`,
    );
  }

  if (manifest && manifest.commitSha === latestSha) {
    console.error(
      `Knowledge cache is fresh (${latestSha.slice(0, 7)}), using cached files`,
    );
    return loadFromCache();
  }

  console.error(
    `Fetching knowledge files from GitHub (${latestSha.slice(0, 7)})...`,
  );

  // Get the recursive tree (1 API call) to enumerate knowledge files.
  const tree = await fetchTree(latestSha);
  const knowledgeFiles = tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path.startsWith(`${KNOWLEDGE_PATH}/`) &&
      isAllowedPath(item.path.slice(KNOWLEDGE_PATH.length + 1)),
  );

  // Phase 1: download every file into memory. Abort on the first non-404
  // failure so we never persist a partial cache.
  const files: KnowledgeFile[] = [];
  const batchSize = 20; // raw.githubusercontent.com has no rate limit, so we can be more parallel
  let droppedCount = 0;

  try {
    for (let i = 0; i < knowledgeFiles.length; i += batchSize) {
      const batch = knowledgeFiles.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (item) => {
          const relativePath = item.path.slice(KNOWLEDGE_PATH.length + 1);
          const content = await fetchFileContent(latestSha, relativePath);
          return content === null ? null : { path: relativePath, content };
        }),
      );
      for (const result of results) {
        if (result === null) {
          droppedCount++;
        } else {
          files.push(result);
        }
      }
    }
  } catch (err) {
    // Any non-404 failure aborts the refresh. The previous manifest and
    // cache files on disk are unchanged, so the next startup will retry.
    console.error(
      `Aborting refresh — ${(err as Error).message}. ` +
        `Previous cache (commit ${manifest?.commitSha.slice(0, 7) ?? "none"}) preserved.`,
    );
    if (manifest) {
      return loadFromCache();
    }
    throw err;
  }

  // Phase 2: persist to disk. Files are written first, then index.json,
  // then the manifest LAST (atomically) so a crash mid-write cannot leave
  // the freshness check thinking we have content we don't.
  for (const file of files) {
    writeFileSync(getCacheFilePath(file.path), JSON.stringify(file));
  }
  const index = files.map((f) => f.path);
  writeFileSync(join(cacheDir, "index.json"), JSON.stringify(index));
  writeCacheManifestAtomic({
    commitSha: latestSha,
    fetchedAt: new Date().toISOString(),
    fileCount: files.length,
  });

  console.error(
    `Cached ${files.length} knowledge files` +
      (droppedCount > 0 ? ` (${droppedCount} files were 404 and dropped)` : ""),
  );
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
