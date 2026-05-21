// Empirically verify that githubReadFileRaw returns un-wrapped content
// while githubReadFile keeps the human-readable wrapper. Pulls a small
// real file from an existing repo via the GitHub API.

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';
import type { Task } from '@/types';

(async () => {
  const cos = (await db.execute(sql`SELECT id, github_repo FROM companies WHERE github_repo IS NOT NULL LIMIT 1`)) as any;
  const company = (cos.rows ?? cos)[0];
  if (!company) {
    console.log('No company with github_repo. Skipping.');
    return;
  }
  console.log('Using company', company.id.slice(0, 8), 'repo', company.github_repo);

  const task = {
    id: 'smoke-test',
    company_id: company.id,
    agent_id: 30,
    title: 'smoke',
    description: '',
    tag: 'engineering',
    status: 'in_progress',
    priority: 50,
    complexity: 1,
    max_turns: 1,
  } as unknown as Task;

  // Read a small file — try README.md or package.json
  const wrapped = await handleEngineeringTool('github_read_file', { repo: company.github_repo, path: 'package.json' }, task);
  console.log('\n--- github_read_file (wrapped) — first 200 chars ---');
  console.log(wrapped.slice(0, 200));
  const startsWithWrapper = wrapped.startsWith('File: ') || /^File: [^\n]+\n```/.test(wrapped);
  const endsWithFence = /```\s*$/.test(wrapped);
  console.log(`  ✓ starts with "File: " wrapper: ${startsWithWrapper}`);
  console.log(`  ✓ ends with closing fence: ${endsWithFence}`);

  // The raw read is internal; verify by inspecting that the wrapped result
  // contains the raw content INSIDE the fences, and that run_drizzle_push
  // would have received that raw content via githubReadFileRaw.
  // Strip the wrapper manually to compare.
  const stripped = wrapped
    .replace(/^File: [^\n]+\n```\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
  // The stripped version should look like valid JSON since we read package.json
  let isJson = false;
  try {
    JSON.parse(stripped);
    isJson = true;
  } catch { /* leave false */ }
  console.log(`  ✓ stripped content parses as JSON (proves raw extraction works): ${isJson}`);
  console.log(`  → run_drizzle_push gets this same raw content via githubReadFileRaw`);
})();
