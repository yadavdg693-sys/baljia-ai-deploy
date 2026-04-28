// Debug: queryforge's "campaign draft generator" task was marked complete
// but the live site shows the same landing page. What did the agent actually do?
// Run: npx tsx --env-file=.env.local src/scripts/debug-queryforge-task.ts

import { db, companies, tasks, taskExecutions, platformEvents } from '@/lib/db';
import { and, eq, desc, gte } from 'drizzle-orm';
import { getWorkerScriptSource } from '@/lib/services/cf-deploy.service';

async function main() {
  // 1. Find queryforge company
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, 'queryforge'))
    .limit(1);

  if (!company) { console.error('queryforge not found'); process.exit(1); }
  console.log('═══ QueryForge company state ═══');
  console.log(`  id: ${company.id}`);
  console.log(`  slug: ${company.slug}`);
  console.log(`  hosting_state: ${company.hosting_state}`);
  console.log(`  custom_domain: ${company.custom_domain}`);
  console.log(`  github_repo: ${company.github_repo}`);
  console.log(`  render_service_id: ${company.render_service_id ?? '(none)'}`);
  console.log(`  neon_provisioned: ${company.neon_connection_string ? 'yes' : 'no'}`);
  console.log();

  // 2. Find the campaign generator task
  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.company_id, company.id))
    .orderBy(desc(tasks.created_at))
    .limit(20);

  console.log('═══ Last 20 tasks for queryforge ═══');
  for (const t of allTasks) {
    const created = (t.created_at instanceof Date ? t.created_at : new Date(String(t.created_at))).toISOString().slice(0, 16);
    console.log(`  ${created}  ${t.status.padEnd(18)} ${t.tag.padEnd(12)} turns=${t.turn_count}/${t.max_turns}  ${t.title?.slice(0, 70) ?? ''}`);
  }
  console.log();

  const campaignTask = allTasks.find((t) => t.title?.includes('campaign'));
  if (!campaignTask) { console.log('No campaign task found in last 20'); process.exit(0); }

  console.log(`═══ Campaign task detail (${campaignTask.id}) ═══`);
  console.log(`  status:           ${campaignTask.status}`);
  console.log(`  failure_class:    ${campaignTask.failure_class ?? '(none)'}`);
  console.log(`  assigned_agent:   ${campaignTask.assigned_to_agent_id}`);
  console.log(`  description:      ${campaignTask.description?.slice(0, 200) ?? '(none)'}`);
  console.log();

  // 3. Get all executions for this task
  const execs = await db
    .select()
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, campaignTask.id))
    .orderBy(desc(taskExecutions.created_at));

  console.log(`═══ Executions for this task: ${execs.length} ═══`);
  for (const e of execs) {
    console.log(`  ${e.id} status=${e.status} mode=${e.execution_mode} turns=${e.turn_count} wall=${e.wall_clock_seconds}s`);
    if (e.error_summary) console.log(`    error: ${e.error_summary.slice(0, 200)}`);
    if (e.verification_evidence) console.log(`    verification: ${typeof e.verification_evidence === 'string' ? e.verification_evidence.slice(0, 200) : JSON.stringify(e.verification_evidence).slice(0, 200)}`);
    if (e.execution_log) {
      const log = typeof e.execution_log === 'string' ? e.execution_log : JSON.stringify(e.execution_log);
      console.log(`    execution_log (first 800 chars): ${log.slice(0, 800)}`);
    }
  }
  console.log();

  // 4. What tool calls did the agent make? Check platform_events
  const events = await db
    .select()
    .from(platformEvents)
    .where(and(
      eq(platformEvents.company_id, company.id),
      gte(platformEvents.created_at, campaignTask.created_at ?? new Date(0)),
    ))
    .orderBy(desc(platformEvents.created_at))
    .limit(50);

  console.log(`═══ Platform events since task created: ${events.length} ═══`);
  for (const ev of events.slice(0, 30)) {
    const ts = (ev.created_at instanceof Date ? ev.created_at : new Date(String(ev.created_at))).toISOString().slice(11, 19);
    const payloadStr = typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload);
    console.log(`  ${ts}  ${ev.event_type?.padEnd(25)}  ${payloadStr?.slice(0, 100) ?? ''}`);
  }
  console.log();

  // 5. What's actually deployed at queryforge.baljia.app?
  console.log('═══ Live site state ═══');
  try {
    const probe = await fetch('https://queryforge.baljia.app/');
    console.log(`  GET / → HTTP ${probe.status}`);
    console.log(`  x-baljia-tier: ${probe.headers.get('x-baljia-tier') ?? '(none)'}`);
    console.log(`  x-baljia-subdomain: ${probe.headers.get('x-baljia-subdomain') ?? '(none)'}`);
    const body = await probe.text();
    console.log(`  body bytes: ${body.length}`);
    console.log(`  body first 300 chars:`);
    console.log(`    ${body.slice(0, 300).replace(/\n/g, '\\n')}`);
  } catch (e) { console.log(`  probe failed: ${e instanceof Error ? e.message : e}`); }
  console.log();

  // 6. Is there a Worker deployed for queryforge?
  const scriptName = `baljia-app-queryforge`;
  const workerSrc = await getWorkerScriptSource(scriptName);
  if (workerSrc) {
    console.log(`═══ CF Worker source for ${scriptName} ═══`);
    console.log(`  bytes: ${workerSrc.bytes}`);
    console.log(`  etag:  ${workerSrc.etag.slice(0, 16)}…`);
    console.log(`  source first 500 chars:`);
    console.log(`    ${workerSrc.source.slice(0, 500).replace(/\n/g, '\\n')}`);
    console.log(`  contains "campaign":      ${workerSrc.source.toLowerCase().includes('campaign')}`);
    console.log(`  contains "generator":     ${workerSrc.source.toLowerCase().includes('generator')}`);
    console.log(`  contains "/api/":         ${workerSrc.source.includes('/api/')}`);
  } else {
    console.log(`═══ No CF Worker deployed for ${scriptName} ═══`);
    console.log('  This means the agent NEVER called cf_deploy_app for this task.');
    console.log('  queryforge.baljia.app is being served by the wildcard Worker (Tier 1 R2 landing).');
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
