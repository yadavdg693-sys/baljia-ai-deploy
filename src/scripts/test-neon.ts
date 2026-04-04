// Quick test: verify Drizzle can read from Neon
import { config } from 'dotenv';
config({ path: '.env.local' });

import { db, users, companies, tasks, agents, creditLedger } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🔌 Testing Neon + Drizzle connection...\n');

  // Test 1: Raw query
  const result = await db.execute(sql`SELECT current_database(), current_timestamp`);
  console.log('✅ Connected to:', (result as unknown as { rows: Array<{ current_database: string }> }).rows?.[0]?.current_database ?? 'neondb');

  // Test 2: Count tables
  const tables = [
    { name: 'users', table: users },
    { name: 'companies', table: companies },
    { name: 'tasks', table: tasks },
    { name: 'agents', table: agents },
    { name: 'credit_ledger', table: creditLedger },
  ];

  for (const { name, table } of tables) {
    try {
      const rows = await db.select().from(table).limit(1);
      console.log(`  ✅ ${name} — accessible (${rows.length} rows)`);
    } catch (e) {
      console.log(`  ❌ ${name} — ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  // Test 3: Seed agents if empty
  const existingAgents = await db.select().from(agents);
  if (existingAgents.length === 0) {
    console.log('\n📦 Seeding agents...');
    await db.insert(agents).values([
      { id: 0, name: 'CEO', role: 'Founder-facing brain, planning, routing, credit guardrail', default_max_turns: 0, execution_style: 'agentic' },
      { id: 30, name: 'Engineering', role: 'Build, fix, deploy, integrate', default_max_turns: 200, execution_style: 'agentic' },
      { id: 42, name: 'Browser', role: 'Interactive web execution, credential management', default_max_turns: 200, execution_style: 'structured' },
      { id: 29, name: 'Research', role: 'Web research, synthesis, qualification', default_max_turns: 200, execution_style: 'structured' },
      { id: 33, name: 'Data', role: 'SQL, metrics, logs, analysis', default_max_turns: 200, execution_style: 'structured' },
      { id: 32, name: 'Support', role: 'Customer email replies, escalation', default_max_turns: 200, execution_style: 'structured' },
      { id: 40, name: 'Twitter', role: 'Compose and post tweets', default_max_turns: 200, execution_style: 'graph' },
      { id: 41, name: 'MetaAds', role: 'Ad creation, optimization, campaign control', default_max_turns: 100, execution_style: 'graph' },
      { id: 54, name: 'ColdOutreach', role: 'Outbound email, verification, follow-ups', default_max_turns: 200, execution_style: 'graph' },
    ]);
    console.log('  ✅ 9 agents seeded');
  } else {
    console.log(`\n✅ Agents already seeded (${existingAgents.length} found)`);
  }

  console.log('\n🎉 Neon database is ready!');
}

main().catch(console.error);
