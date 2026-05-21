// Runtime-only code graph support for Engineering Agent.
// Graphify output is stored in temp/cache + compact internal documents only.

import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';

import { db, companies, documents } from '@/lib/db';
import { githubFetch } from '@/lib/services/github-throttle';
import * as documentService from './document.service';

const execFileAsync = promisify(execFile);

export const CODE_GRAPH_REPORT_DOC_TYPE = 'code_graph_report';
export const CODE_GRAPH_MANIFEST_DOC_TYPE = 'code_graph_manifest';
export const GRAPHIFY_VERSION = '0.7.16';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_GRAPHIFY_BUILD_TIMEOUT_MS = 120_000;
const MAX_ACCEPTED_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024;
const MAX_FILES = 400;
const MAX_GRAPH_JSON_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 160_000;
const CACHE_ROOT = join(tmpdir(), 'baljia-code-graphs');
const GRAPH_CONFIG_VERSION = 1;

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.sql',
  '.prisma',
  '.css',
]);

const SKIP_SEGMENTS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.wrangler',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
  'graphify-out',
]);

const SKIP_BASENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'npm-shrinkwrap.json',
]);

type GraphifyCommand = {
  command: string;
  argsPrefix: string[];
};

type GraphNode = {
  id?: string;
  label?: string;
  source_file?: string;
  source_location?: string;
  file_type?: string;
  [key: string]: unknown;
};

type GraphLink = {
  source?: string;
  target?: string;
  relation?: string;
  context?: string;
  source_file?: string;
  [key: string]: unknown;
};

type ParsedGraph = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export type CodeGraphManifest = {
  schema_version: 1;
  company_id: string;
  github_repo: string;
  repo_sha: string;
  default_branch: string;
  graphify_version: string;
  graph_config_hash: string;
  file_count: number;
  accepted_bytes: number;
  skipped_count: number;
  built_at: string;
  cache_dir: string;
};

export type CodeGraphBuildResult = {
  ok: boolean;
  unavailable?: boolean;
  reason?: string;
  manifest?: CodeGraphManifest;
  reportExcerpt?: string;
};

export type CodeGraphQueryResult = {
  ok: boolean;
  unavailable?: boolean;
  reason?: string;
  answer: string;
  evidenceMarker: string;
};

type CompanyRepoInfo = {
  repo: string;
};

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: 'application/vnd.github+json',
    'User-Agent': 'baljia-code-graph',
  };
}

export function shouldIncludeCodeGraphPath(filePath: string, sizeBytes: number): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const base = basename(normalized);
  if (sizeBytes > MAX_FILE_BYTES) return false;
  if (base.startsWith('.env')) return false;
  if (SKIP_BASENAMES.has(base)) return false;
  if (/\.(pem|key|crt|cer|p12|pfx|png|jpg|jpeg|gif|webp|ico|svg|pdf|zip|gz|tgz|mp4|mov|woff2?|ttf|otf)$/i.test(base)) return false;
  if (/generated|\.generated\.|\.gen\./i.test(normalized)) return false;
  if (normalized.split('/').some((segment) => SKIP_SEGMENTS.has(segment))) return false;
  const ext = base.includes('.') ? `.${base.split('.').pop()!.toLowerCase()}` : '';
  return ALLOWED_EXTENSIONS.has(ext);
}

export function redactCodeGraphText(input: string): string {
  return input
    .replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, 'postgres://<REDACTED>')
    .replace(/(?:sk|pk)_(?:live|test)_[A-Za-z0-9_]{12,}/g, '<REDACTED_STRIPE_KEY>')
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g, '<REDACTED_GITHUB_TOKEN>')
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, '<REDACTED_AWS_KEY>')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]+?-----END [^-]+ PRIVATE KEY-----/g, '<REDACTED_PRIVATE_KEY>')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, '<REDACTED_EMAIL>');
}

export function codeGraphConfigHash(): string {
  const payload = JSON.stringify({
    version: GRAPH_CONFIG_VERSION,
    allowed: [...ALLOWED_EXTENSIONS].sort(),
    maxAcceptedBytes: MAX_ACCEPTED_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
    maxFiles: MAX_FILES,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function codeGraphCacheKey(companyId: string, repoSha: string, graphifyVersion = GRAPHIFY_VERSION): string {
  return createHash('sha256')
    .update(`${companyId}:${repoSha}:${graphifyVersion}:${codeGraphConfigHash()}`)
    .digest('hex')
    .slice(0, 24);
}

async function getCompanyRepo(companyId: string): Promise<CompanyRepoInfo | null> {
  const [company] = await db.select({ github_repo: companies.github_repo })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company?.github_repo) return null;
  return { repo: company.github_repo };
}

async function getRepoDefaultBranchAndSha(repo: string): Promise<{ branch: string; sha: string }> {
  const repoResponse = await githubFetch(`${GITHUB_API}/repos/${repo}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!repoResponse.ok) throw new Error(`GitHub repo lookup failed: HTTP ${repoResponse.status}`);
  const repoBody = await repoResponse.json() as { default_branch?: string };
  const branch = repoBody.default_branch ?? 'main';

  const refResponse = await githubFetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!refResponse.ok) throw new Error(`GitHub ref lookup failed: HTTP ${refResponse.status}`);
  const refBody = await refResponse.json() as { object?: { sha?: string } };
  const sha = refBody.object?.sha;
  if (!sha) throw new Error('GitHub ref lookup did not return a SHA');
  return { branch, sha };
}

async function downloadArchive(repo: string, repoSha: string, targetFile: string): Promise<void> {
  const response = await githubFetch(`${GITHUB_API}/repos/${repo}/tarball/${repoSha}`, {
    headers: { ...githubHeaders(), Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`GitHub archive download failed: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`GitHub archive too large: ${contentLength} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error(`GitHub archive too large: ${bytes.length} bytes`);
  await writeFile(targetFile, bytes);
}

async function runTarExtract(archiveFile: string, targetDir: string): Promise<void> {
  await execFileAsync('tar', ['-xf', archiveFile, '-C', targetDir], {
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 512 * 1024,
  });
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(root, { withFileTypes: true }));
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_SEGMENTS.has(entry.name)) files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function copyAllowedFiles(extractedRoot: string, workspace: string): Promise<{ fileCount: number; acceptedBytes: number; skippedCount: number }> {
  const files = await walkFiles(extractedRoot);
  const roots = await import('node:fs/promises').then((fs) => fs.readdir(extractedRoot, { withFileTypes: true }));
  const archiveRoot = roots.find((entry) => entry.isDirectory())?.name;
  const sourceRoot = archiveRoot ? join(extractedRoot, archiveRoot) : extractedRoot;
  let acceptedBytes = 0;
  let fileCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const rel = relative(sourceRoot, file).replace(/\\/g, '/');
    if (rel.startsWith('..')) continue;
    const size = (await stat(file)).size;
    if (!shouldIncludeCodeGraphPath(rel, size) || acceptedBytes + size > MAX_ACCEPTED_BYTES || fileCount >= MAX_FILES) {
      skippedCount += 1;
      continue;
    }
    const outputPath = join(workspace, rel);
    await mkdir(dirname(outputPath), { recursive: true });
    const content = await readFile(file, 'utf8').catch(() => null);
    if (content === null || content.includes('\u0000')) {
      skippedCount += 1;
      continue;
    }
    await writeFile(outputPath, redactCodeGraphText(content), 'utf8');
    acceptedBytes += Buffer.byteLength(content);
    fileCount += 1;
  }

  return { fileCount, acceptedBytes, skippedCount };
}

async function commandWorks(command: GraphifyCommand): Promise<boolean> {
  try {
    await execFileAsync(command.command, [...command.argsPrefix, '--help'], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveGraphifyCommand(): Promise<GraphifyCommand | null> {
  if (process.env.GRAPHIFY_ENABLED === 'false') return null;
  const explicit = process.env.GRAPHIFY_BIN?.trim();
  const candidates: GraphifyCommand[] = [
    ...(explicit ? [{ command: explicit, argsPrefix: [] }] : []),
    { command: 'graphify', argsPrefix: [] },
    { command: 'python', argsPrefix: ['-m', 'graphify'] },
    { command: 'python3', argsPrefix: ['-m', 'graphify'] },
  ];
  for (const candidate of candidates) {
    if (await commandWorks(candidate)) return candidate;
  }
  return null;
}

async function runGraphify(command: GraphifyCommand, args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  const result = await execFileAsync(command.command, [...command.argsPrefix, ...args], {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  return `${result.stdout ?? ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
}

async function upsertInternalDocument(companyId: string, docType: string, title: string, content: string): Promise<void> {
  const existing = await documentService.getDocumentByType(companyId, docType);
  if (existing) {
    await documentService.updateDocument(existing.id, content);
    return;
  }
  await db.insert(documents).values({
    company_id: companyId,
    doc_type: docType,
    title,
    content,
    source: 'engineering_agent',
    version: 1,
    is_empty: false,
  });
}

async function readManifest(companyId: string): Promise<CodeGraphManifest | null> {
  const doc = await documentService.getDocumentByType(companyId, CODE_GRAPH_MANIFEST_DOC_TYPE);
  if (!doc?.content) return null;
  try {
    return JSON.parse(doc.content) as CodeGraphManifest;
  } catch {
    return null;
  }
}

async function cacheDirForManifest(manifest: CodeGraphManifest): Promise<string | null> {
  const graphPath = join(manifest.cache_dir, 'graphify-out', 'graph.json');
  return existsSync(graphPath) ? manifest.cache_dir : null;
}

export async function buildCodeGraph(companyId: string, opts: { force?: boolean } = {}): Promise<CodeGraphBuildResult> {
  const repoInfo = await getCompanyRepo(companyId);
  if (!repoInfo) return { ok: false, unavailable: true, reason: 'No github_repo stored for this company.' };

  const graphify = await resolveGraphifyCommand();
  if (!graphify) return { ok: false, unavailable: true, reason: 'Graphify CLI unavailable. Install graphifyy==0.7.16 in the worker.' };

  try {
    const { branch, sha } = await getRepoDefaultBranchAndSha(repoInfo.repo);
    const cacheKey = codeGraphCacheKey(companyId, sha);
    const cacheDir = join(CACHE_ROOT, cacheKey);
    const graphJsonPath = join(cacheDir, 'graphify-out', 'graph.json');
    if (!opts.force && existsSync(graphJsonPath)) {
      const manifest = await readManifest(companyId);
      const report = await readFile(join(cacheDir, 'graphify-out', 'GRAPH_REPORT.md'), 'utf8').catch(() => '');
      return {
        ok: true,
        manifest: manifest ?? {
          schema_version: 1,
          company_id: companyId,
          github_repo: repoInfo.repo,
          repo_sha: sha,
          default_branch: branch,
          graphify_version: GRAPHIFY_VERSION,
          graph_config_hash: codeGraphConfigHash(),
          file_count: 0,
          accepted_bytes: 0,
          skipped_count: 0,
          built_at: new Date().toISOString(),
          cache_dir: cacheDir,
        },
        reportExcerpt: redactCodeGraphText(report).slice(0, 4000),
      };
    }

    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    const scratch = await mkdtemp(join(tmpdir(), `baljia-code-graph-${randomUUID()}-`));
    try {
      const archiveFile = join(scratch, 'repo.tar.gz');
      const extractedDir = join(scratch, 'archive');
      const workspace = join(cacheDir, 'repo');
      await mkdir(extractedDir, { recursive: true });
      await mkdir(workspace, { recursive: true });
      await downloadArchive(repoInfo.repo, sha, archiveFile);
      await runTarExtract(archiveFile, extractedDir);
      const copyStats = await copyAllowedFiles(extractedDir, workspace);
      if (copyStats.fileCount === 0) {
        return { ok: false, unavailable: true, reason: 'No allowed code files found after filtering.' };
      }

      await runGraphify(graphify, ['update', workspace, '--force'], DEFAULT_GRAPHIFY_BUILD_TIMEOUT_MS);
      const graphPath = join(workspace, 'graphify-out', 'graph.json');
      const reportPath = join(workspace, 'graphify-out', 'GRAPH_REPORT.md');
      const graphSize = (await stat(graphPath)).size;
      const reportSize = (await stat(reportPath)).size;
      if (graphSize > MAX_GRAPH_JSON_BYTES) throw new Error(`graph.json too large: ${graphSize} bytes`);
      if (reportSize > MAX_REPORT_BYTES) throw new Error(`GRAPH_REPORT.md too large: ${reportSize} bytes`);

      // Keep Graphify's output at cache root for stable manifest paths.
      await rm(join(cacheDir, 'graphify-out'), { recursive: true, force: true });
      await import('node:fs/promises').then((fs) => fs.rename(join(workspace, 'graphify-out'), join(cacheDir, 'graphify-out')));
      const rawReport = await readFile(join(cacheDir, 'graphify-out', 'GRAPH_REPORT.md'), 'utf8');
      const report = redactCodeGraphText(rawReport);
      const manifest: CodeGraphManifest = {
        schema_version: 1,
        company_id: companyId,
        github_repo: repoInfo.repo,
        repo_sha: sha,
        default_branch: branch,
        graphify_version: GRAPHIFY_VERSION,
        graph_config_hash: codeGraphConfigHash(),
        file_count: copyStats.fileCount,
        accepted_bytes: copyStats.acceptedBytes,
        skipped_count: copyStats.skippedCount,
        built_at: new Date().toISOString(),
        cache_dir: cacheDir,
      };
      await upsertInternalDocument(companyId, CODE_GRAPH_REPORT_DOC_TYPE, 'Code Graph Report (internal)', report.slice(0, 60_000));
      await upsertInternalDocument(companyId, CODE_GRAPH_MANIFEST_DOC_TYPE, 'Code Graph Manifest (internal)', JSON.stringify(manifest, null, 2));
      return { ok: true, manifest, reportExcerpt: report.slice(0, 4000) };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      ok: false,
      unavailable: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readCodeGraphReport(companyId: string): Promise<string> {
  const report = await documentService.getDocumentByType(companyId, CODE_GRAPH_REPORT_DOC_TYPE);
  if (!report?.content) return 'No code graph yet. Call build_code_graph or query_code_graph first.';
  return redactCodeGraphText(report.content).slice(0, 8000);
}

async function loadGraph(companyId: string): Promise<{ graph: ParsedGraph; manifest: CodeGraphManifest } | null> {
  const manifest = await readManifest(companyId);
  if (!manifest) return null;
  const cacheDir = await cacheDirForManifest(manifest);
  if (!cacheDir) return null;
  const graphRaw = await readFile(join(cacheDir, 'graphify-out', 'graph.json'), 'utf8');
  const parsed = JSON.parse(graphRaw) as Partial<ParsedGraph>;
  const repoRoot = join(cacheDir, 'repo');
  const normalizeSourceFile = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value) return undefined;
    const rel = relative(repoRoot, value).replace(/\\/g, '/');
    return rel && !rel.startsWith('..') && rel !== value ? rel : value.replace(/\\/g, '/');
  };
  return {
    graph: {
      nodes: (parsed.nodes ?? []).map((node) => ({
        ...node,
        source_file: normalizeSourceFile(node.source_file),
      })),
      links: (parsed.links ?? []).map((link) => ({
        ...link,
        source_file: normalizeSourceFile(link.source_file),
      })),
    },
    manifest,
  };
}

function scoreNodeForQuestion(node: GraphNode, question: string): number {
  const q = question.toLowerCase();
  const haystack = `${node.label ?? ''} ${node.id ?? ''} ${node.source_file ?? ''}`.toLowerCase();
  const terms = [...new Set(q.match(/[a-z0-9_/-]{3,}/g) ?? [])];
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length > 5 ? 3 : 1;
    if (term.endsWith('ing') && haystack.includes(term.slice(0, -3))) score += 2;
    if (term.endsWith('s') && haystack.includes(term.slice(0, -1))) score += 2;
  }
  if (/route|api/.test(q) && /api|route/.test(haystack)) score += 4;
  if (/table|schema|database|db/.test(q) && /schema|table|db/.test(haystack)) score += 4;
  if (/ui|page|component|button|form/.test(q) && /page|component|tsx|jsx/.test(haystack)) score += 4;
  return score;
}

function relevantGraphFiles(graph: ParsedGraph, question: string): Array<{ file: string; nodes: string[]; score: number }> {
  const byFile = new Map<string, { file: string; nodes: string[]; score: number }>();
  for (const node of graph.nodes) {
    const file = node.source_file;
    if (!file) continue;
    const score = scoreNodeForQuestion(node, question);
    if (score <= 0) continue;
    const entry = byFile.get(file) ?? { file, nodes: [], score: 0 };
    entry.score += score;
    if (node.label && entry.nodes.length < 8) entry.nodes.push(node.label);
    byFile.set(file, entry);
  }
  return [...byFile.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 12);
}

function explainNodeFromGraph(graph: ParsedGraph, query: string): string {
  const lower = query.toLowerCase();
  const node = graph.nodes.find((candidate) =>
    String(candidate.id ?? '').toLowerCase() === lower ||
    String(candidate.label ?? '').toLowerCase() === lower ||
    String(candidate.source_file ?? '').toLowerCase() === lower
  ) ?? graph.nodes.find((candidate) =>
    `${candidate.id ?? ''} ${candidate.label ?? ''} ${candidate.source_file ?? ''}`.toLowerCase().includes(lower)
  );
  if (!node) return `No code graph node matched "${query}".`;
  const nodeId = node.id;
  const neighbors = graph.links
    .filter((link) => link.source === nodeId || link.target === nodeId)
    .slice(0, 20)
    .map((link) => `- ${link.source === nodeId ? 'out' : 'in'} ${link.relation ?? 'related'}: ${link.source} -> ${link.target}${link.source_file ? ` (${link.source_file})` : ''}`);
  return [
    `Node: ${node.label ?? node.id}`,
    `File: ${node.source_file ?? 'unknown'}${node.source_location ? `:${node.source_location}` : ''}`,
    `Type: ${node.file_type ?? 'unknown'}`,
    'Neighbors:',
    neighbors.join('\n') || '- none',
  ].join('\n');
}

function pathFromGraph(graph: ParsedGraph, from: string, to: string): string {
  const findNode = (query: string) => graph.nodes.find((node) =>
    `${node.id ?? ''} ${node.label ?? ''} ${node.source_file ?? ''}`.toLowerCase().includes(query.toLowerCase())
  );
  const source = findNode(from);
  const target = findNode(to);
  if (!source?.id || !target?.id) return `No code graph path: could not match ${!source ? `"${from}"` : `"${to}"`}.`;
  const adjacency = new Map<string, Array<{ next: string; relation: string }>>();
  for (const link of graph.links) {
    if (!link.source || !link.target) continue;
    const relation = String(link.relation ?? 'related');
    adjacency.set(link.source, [...(adjacency.get(link.source) ?? []), { next: link.target, relation }]);
    adjacency.set(link.target, [...(adjacency.get(link.target) ?? []), { next: link.source, relation }]);
  }
  const queue: Array<{ id: string; path: Array<{ id: string; relation?: string }> }> = [{ id: source.id, path: [{ id: source.id }] }];
  const seen = new Set([source.id]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === target.id) {
      return current.path.map((step, index) => index === 0 ? step.id : `--${step.relation}--> ${step.id}`).join(' ');
    }
    if (current.path.length > 6) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      if (seen.has(edge.next)) continue;
      seen.add(edge.next);
      queue.push({ id: edge.next, path: [...current.path, { id: edge.next, relation: edge.relation }] });
    }
  }
  return `No path found between ${source.id} and ${target.id}.`;
}

export async function queryCodeGraph(companyId: string, question: string): Promise<CodeGraphQueryResult> {
  let loaded = await loadGraph(companyId);
  if (!loaded) {
    const built = await buildCodeGraph(companyId);
    if (!built.ok) {
      return {
        ok: false,
        unavailable: true,
        reason: built.reason,
        evidenceMarker: `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(built.reason ?? 'unknown')}`,
        answer: `CODE_GRAPH_UNAVAILABLE: ${built.reason ?? 'unknown'}. Fallback to codebase_map, github_list_files, github_read_file, and rg-style path searches.`,
      };
    }
    loaded = await loadGraph(companyId);
  }
  if (!loaded) {
    return {
      ok: false,
      unavailable: true,
      reason: 'Graph was built but could not be loaded from cache.',
      evidenceMarker: 'CODE_GRAPH_UNAVAILABLE reason="cache load failed"',
      answer: 'CODE_GRAPH_UNAVAILABLE: cache load failed. Fallback to codebase_map and GitHub read tools.',
    };
  }

  const matches = relevantGraphFiles(loaded.graph, question);
  const lines = [
    `CODE_GRAPH_QUERY_EVIDENCE repo_sha=${loaded.manifest.repo_sha} files=${matches.length}`,
    `Question: ${question}`,
    '',
    matches.length > 0 ? 'Relevant files/routes/entities:' : 'No high-confidence graph matches. Fallback to codebase_map and GitHub file search.',
    ...matches.map((match) => `- ${match.file} (score=${match.score}; nodes=${match.nodes.join(', ') || 'n/a'})`),
  ];
  return {
    ok: true,
    evidenceMarker: lines[0],
    answer: redactCodeGraphText(lines.join('\n')).slice(0, 8000),
  };
}

export async function explainCodeNode(companyId: string, node: string): Promise<CodeGraphQueryResult> {
  const loaded = await loadGraph(companyId);
  if (!loaded) {
    return await queryCodeGraph(companyId, node);
  }
  const answer = `CODE_GRAPH_NODE_EVIDENCE repo_sha=${loaded.manifest.repo_sha}\n${explainNodeFromGraph(loaded.graph, node)}`;
  return { ok: true, evidenceMarker: answer.split('\n')[0], answer: redactCodeGraphText(answer).slice(0, 8000) };
}

export async function codeGraphPath(companyId: string, from: string, to: string): Promise<CodeGraphQueryResult> {
  const loaded = await loadGraph(companyId);
  if (!loaded) {
    const built = await buildCodeGraph(companyId);
    if (!built.ok) {
      return {
        ok: false,
        unavailable: true,
        reason: built.reason,
        evidenceMarker: `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(built.reason ?? 'unknown')}`,
        answer: `CODE_GRAPH_UNAVAILABLE: ${built.reason ?? 'unknown'}.`,
      };
    }
  }
  const fresh = await loadGraph(companyId);
  if (!fresh) {
    return { ok: false, unavailable: true, reason: 'cache load failed', evidenceMarker: 'CODE_GRAPH_UNAVAILABLE reason="cache load failed"', answer: 'CODE_GRAPH_UNAVAILABLE: cache load failed.' };
  }
  const answer = `CODE_GRAPH_PATH_EVIDENCE repo_sha=${fresh.manifest.repo_sha}\n${pathFromGraph(fresh.graph, from, to)}`;
  return { ok: true, evidenceMarker: answer.split('\n')[0], answer: redactCodeGraphText(answer).slice(0, 8000) };
}
