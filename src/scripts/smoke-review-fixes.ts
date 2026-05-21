// Smoke test for the 5 review-driven fixes.
import { readFile } from 'node:fs/promises';
import { isDesignCritiqueConfigured } from '@/lib/services/design-critic.service';

(async () => {
  console.log('=== P1.2: frontend-design SKILL.md no longer Express-first ===');
  const skill = await readFile('.claude/skills/frontend-design/SKILL.md', 'utf8');
  console.log('  says Express:', /Express for routes and APIs/.test(skill));
  console.log('  says Next.js + shadcn:', /Next\.js 15 \+ shadcn\/ui/.test(skill));
  console.log('  references list_design_systems:', /list_design_systems/.test(skill));
  console.log('  has hard quality bar:', /Frontend Quality Bar \(hard fails\)/.test(skill));

  console.log('\n=== P1.1: DB prompt override appends invariants ===');
  const factory = await readFile('src/lib/agents/agent-factory.ts', 'utf8');
  console.log('  has getInvariantRulesForAgent:', /function getInvariantRulesForAgent/.test(factory));
  console.log('  appends instead of replacing:', /\+ getInvariantRulesForAgent\(agentId\)/.test(factory));
  console.log('  invariants mention design_critique:', /design_critique/.test(factory.match(/ENGINEERING_INVARIANT_RULES = `[\s\S]*?`/)![0]));

  console.log('\n=== P1.5: GitHub ownership guard wired ===');
  const eng = await readFile('src/lib/agents/tools/engineering.tools.ts', 'utf8');
  const guardCalls = (eng.match(/assertRepoOwnership\(/g) ?? []).length;
  console.log('  assertRepoOwnership calls:', guardCalls);
  console.log('  has read/write distinction:', /SHARED_SKELETON_REPOS/.test(eng));
  console.log('  no duplicate definitions:', (eng.match(/^async function assertRepoOwnership/gm) ?? []).length === 1);

  console.log('\n=== P2.1: github_delete_file schema has confirm ===');
  const deleteSchema = eng.match(/name: 'github_delete_file'[\s\S]*?required: \[[^\]]+\]/)![0];
  console.log('  schema lists confirm property:', /confirm: \{ type: 'boolean'/.test(deleteSchema));
  console.log('  confirm is required:', /required: \[[^\]]*'confirm'/.test(deleteSchema));

  console.log('\n=== P1.4: design_critique gate is config-aware ===');
  console.log('  isDesignCritiqueConfigured returns:', isDesignCritiqueConfigured());
  console.log('  gate gated on critiqueConfigured:', /if \(critiqueConfigured\) \{/.test(factory));
})();
