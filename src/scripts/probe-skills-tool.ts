// Direct probe: do the list_skills and read_skill tools work when called outside the LLM?
// If yes, the agent's "Skills tools appear unavailable" claim was a hallucination,
// not a real plumbing bug. If no, we have a real bug to fix.
// Run: npx tsx --env-file=.env.local src/scripts/probe-skills-tool.ts

import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';

async function main() {
  console.log('── list_skills ──');
  const list = await handleEngineeringTool('list_skills', {}, 'probe-no-company');
  console.log(list);
  console.log('\n── read_skill build-fullstack-cf-app (first 600 chars) ──');
  const read = await handleEngineeringTool('read_skill', { skill: 'build-fullstack-cf-app' }, 'probe-no-company');
  console.log(read.slice(0, 600));
  console.log('\n── read_skill cloudflare-workers (first 300 chars) ──');
  const read2 = await handleEngineeringTool('read_skill', { skill: 'cloudflare-workers' }, 'probe-no-company');
  console.log(read2.slice(0, 300));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
