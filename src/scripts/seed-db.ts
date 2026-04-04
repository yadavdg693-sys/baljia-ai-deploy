// Seed Database — push schema + seed agents
// Run: npx tsx src/scripts/seed-db.ts

// IMPORTANT: dotenv must load BEFORE any other imports
// because db/client.ts reads DATABASE_URL at module init time
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  console.log('Baljia AI — Database Seed\n');

  // Dynamic import AFTER env is loaded
  const { db, agents } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  // 1. Test connection
  console.log('1. Testing database connection...');
  try {
    const result = await db.execute(sql`SELECT current_database(), current_user`);
    console.log(`   Connected to: ${JSON.stringify(result.rows[0])}\n`);
  } catch (e) {
    console.error('   Failed to connect to database:', e);
    process.exit(1);
  }

  // 2. Check if tables exist
  console.log('2. Checking tables...');
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  const tableNames = (tables.rows as Array<{ table_name: string }>).map(r => r.table_name);
  console.log(`   Found ${tableNames.length} tables: ${tableNames.join(', ')}\n`);

  if (!tableNames.includes('agents')) {
    console.log('   "agents" table not found. Run "npx drizzle-kit push" first.');
    process.exit(1);
  }

  // 3. Seed agents
  console.log('3. Seeding 9 agents...');
  const AGENTS = [
    { id: 0,  name: 'CEO',          default_max_turns: 5,   default_model: 'claude-sonnet-4-20250514', execution_style: 'agentic',    role: 'AI CEO — founder interaction, task proposals, memory management' },
    { id: 29, name: 'Research',     default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'structured', role: 'Market research, competitive analysis, web intelligence' },
    { id: 30, name: 'Engineering',  default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'agentic',    role: 'Full-stack development, infrastructure, deployment' },
    { id: 32, name: 'Support',      default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'structured', role: 'Customer support, email handling, escalations' },
    { id: 33, name: 'Data',         default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'structured', role: 'SQL queries, analytics, business intelligence' },
    { id: 40, name: 'Twitter',      default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'graph',      role: 'Tweet composition, scheduling, engagement' },
    { id: 41, name: 'MetaAds',      default_max_turns: 100, default_model: 'claude-sonnet-4-20250514', execution_style: 'graph',      role: 'Facebook/Instagram ad campaigns, creative, optimization' },
    { id: 42, name: 'Browser',      default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'structured', role: 'Web navigation, form filling, scraping, screenshots' },
    { id: 54, name: 'ColdOutreach', default_max_turns: 200, default_model: 'claude-sonnet-4-20250514', execution_style: 'graph',      role: 'Email finding, verification, personalized outreach' },
  ];

  for (const agent of AGENTS) {
    try {
      await db.insert(agents).values(agent).onConflictDoUpdate({
        target: agents.id,
        set: {
          name: agent.name,
          default_max_turns: agent.default_max_turns,
          default_model: agent.default_model,
          execution_style: agent.execution_style,
          role: agent.role,
        },
      });
      console.log(`   Seeded: ${agent.name} (id=${agent.id})`);
    } catch (e) {
      console.error(`   Failed to seed ${agent.name}:`, e);
    }
  }

  // 4. Verify
  console.log('\n4. Verifying...');
  const count = await db.execute(sql`SELECT count(*)::int as count FROM agents`);
  console.log(`   Agents in database: ${(count.rows[0] as { count: number }).count}`);

  console.log('\nDone! Database is ready.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
