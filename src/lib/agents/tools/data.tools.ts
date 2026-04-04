// Data Agent Tools — migrated to Drizzle + Neon
import type { Task } from '@/types';
import { db, tasks as tasksTable, creditLedger, platformEvents } from '@/lib/db';
import { eq, gte, and, sql } from 'drizzle-orm';

export function getDataTools() {
  return [
    {
      name: 'query_database',
      description: 'Run a read-only SQL query against the company database. Returns results as JSON rows.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'SQL SELECT query (read-only, no mutations)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'inspect_schema',
      description: 'List all tables and their columns in the company database.',
      input_schema: {
        type: 'object' as const,
        properties: {
          table_name: { type: 'string' as const, description: 'Optional: specific table to inspect. If omitted, lists all tables.' },
        },
      },
    },
    {
      name: 'get_metrics',
      description: 'Get platform metrics for the company: task counts by status, credit usage, event activity.',
      input_schema: {
        type: 'object' as const,
        properties: {
          period: { type: 'string' as const, description: 'Time period: "today", "week", "month", "all" (default: week)' },
        },
      },
    },
    {
      name: 'analyze_trends',
      description: 'Analyze trends in company data over time. Returns aggregated metrics.',
      input_schema: {
        type: 'object' as const,
        properties: {
          metric: { type: 'string' as const, description: 'Metric to analyze: "tasks", "credits", "events"' },
          group_by: { type: 'string' as const, description: 'Group by: "day", "week", "month" (default: day)' },
        },
        required: ['metric'],
      },
    },
  ];
}

export async function handleDataTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    case 'query_database': {
      const query = (input.query as string).trim();
      const upper = query.toUpperCase();
      if (/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)/i.test(upper)) {
        return 'ERROR: Only SELECT queries are allowed. Data agent has read-only access.';
      }

      try {
        const result = await db.execute(sql.raw(query));
        const rows = result.rows ?? [];
        return `Query returned ${rows.length} rows:\n${JSON.stringify(rows.slice(0, 50), null, 2)}${rows.length > 50 ? '\n... (truncated, showing first 50)' : ''}`;
      } catch (error) {
        return `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'inspect_schema': {
      try {
        if (input.table_name) {
          // Query real column info from information_schema
          const cols = await db.execute(sql.raw(
            `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${String(input.table_name).replace(/'/g, "''")}' ORDER BY ordinal_position`
          ));
          const rows = cols.rows ?? [];
          if (rows.length === 0) return `Table "${input.table_name}" not found or has no columns.`;
          return `## ${input.table_name} (${rows.length} columns)\n${(rows as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>).map((c) => `- ${c.column_name}: ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ` DEFAULT ${c.column_default}` : ''}`).join('\n')}`;
        }
        // List all tables from information_schema
        const tables = await db.execute(sql.raw(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
        ));
        const tableRows = tables.rows ?? [];
        if (tableRows.length === 0) {
          // Fallback to known platform tables if information_schema query returns empty
          const knownTables = ['companies', 'tasks', 'documents', 'reports', 'credit_ledger', 'platform_events', 'memory_layers', 'learnings', 'subscriptions', 'contacts', 'email_threads', 'browser_credentials', 'ad_campaigns'];
          return `Known platform tables (static fallback):\n${knownTables.map((t) => `- ${t}`).join('\n')}\n\nUse inspect_schema with a specific table_name for column details.`;
        }
        return `## Database Tables (${tableRows.length})\n${(tableRows as Array<{ table_name: string }>).map((t) => `- ${t.table_name}`).join('\n')}\n\nUse inspect_schema with a specific table_name for column details.`;
      } catch (error) {
        return `Schema inspection failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'get_metrics': {
      const period = (input.period as string) ?? 'week';
      const now = new Date();
      let since: Date;

      switch (period) {
        case 'today': since = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case 'week': since = new Date(now.getTime() - 7 * 86400000); break;
        case 'month': since = new Date(now.getTime() - 30 * 86400000); break;
        default: since = new Date(0);
      }

      const [taskRows, creditRows, eventRows] = await Promise.all([
        db.select({ status: tasksTable.status }).from(tasksTable)
          .where(and(eq(tasksTable.company_id, task.company_id), gte(tasksTable.created_at, since))),
        db.select({ amount: creditLedger.amount, entry_type: creditLedger.entry_type }).from(creditLedger)
          .where(and(eq(creditLedger.company_id, task.company_id), gte(creditLedger.created_at, since))),
        db.select({ event_type: platformEvents.event_type }).from(platformEvents)
          .where(and(eq(platformEvents.company_id, task.company_id), gte(platformEvents.created_at, since))),
      ]);

      const taskCounts: Record<string, number> = {};
      for (const t of taskRows) { taskCounts[t.status ?? 'unknown'] = (taskCounts[t.status ?? 'unknown'] ?? 0) + 1; }

      const creditSummary = creditRows.reduce(
        (acc, c) => {
          if (c.amount > 0) acc.earned += c.amount;
          else acc.spent += Math.abs(c.amount);
          return acc;
        },
        { earned: 0, spent: 0 }
      );

      const eventCounts: Record<string, number> = {};
      for (const e of eventRows) { eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1; }

      return `## Metrics (${period})

### Tasks
${Object.entries(taskCounts).map(([s, c]) => `- ${s}: ${c}`).join('\n') || 'No tasks'}

### Credits
- Earned: +${creditSummary.earned}
- Spent: -${creditSummary.spent}
- Net: ${creditSummary.earned - creditSummary.spent}

### Events
${Object.entries(eventCounts).map(([t, c]) => `- ${t}: ${c}`).join('\n') || 'No events'}`;
    }

    case 'analyze_trends': {
      const metric = (input.metric as string) ?? 'tasks';
      const groupBy = (input.group_by as string) ?? 'day';
      
      // Determine the truncation function for date grouping
      const truncFn = groupBy === 'month' ? 'month' : groupBy === 'week' ? 'week' : 'day';
      const lookback = groupBy === 'month' ? 180 : groupBy === 'week' ? 90 : 30;
      const since = new Date(Date.now() - lookback * 86400000);

      try {
        let trendData: Array<{ period: string; count: number }> = [];

        if (metric === 'tasks') {
          const rows = await db.execute(sql`
            SELECT date_trunc(${sql.raw(`'${truncFn}'`)}, created_at)::date as period, count(*)::int as count
            FROM tasks WHERE company_id = ${task.company_id} AND created_at >= ${since}
            GROUP BY period ORDER BY period
          `);
          trendData = (rows.rows ?? []) as Array<{ period: string; count: number }>;
        } else if (metric === 'credits') {
          const rows = await db.execute(sql`
            SELECT date_trunc(${sql.raw(`'${truncFn}'`)}, created_at)::date as period, sum(abs(amount))::int as count
            FROM credit_ledger WHERE company_id = ${task.company_id} AND amount < 0 AND created_at >= ${since}
            GROUP BY period ORDER BY period
          `);
          trendData = (rows.rows ?? []) as Array<{ period: string; count: number }>;
        } else if (metric === 'events') {
          const rows = await db.execute(sql`
            SELECT date_trunc(${sql.raw(`'${truncFn}'`)}, created_at)::date as period, count(*)::int as count
            FROM platform_events WHERE company_id = ${task.company_id} AND created_at >= ${since}
            GROUP BY period ORDER BY period
          `);
          trendData = (rows.rows ?? []) as Array<{ period: string; count: number }>;
        } else {
          return `Unknown metric: "${metric}". Supported: tasks, credits, events.`;
        }

        if (trendData.length === 0) return `No ${metric} data found in the last ${lookback} days.`;

        // Calculate trend direction
        const firstHalf = trendData.slice(0, Math.floor(trendData.length / 2));
        const secondHalf = trendData.slice(Math.floor(trendData.length / 2));
        const avgFirst = firstHalf.reduce((s, r) => s + r.count, 0) / (firstHalf.length || 1);
        const avgSecond = secondHalf.reduce((s, r) => s + r.count, 0) / (secondHalf.length || 1);
        const changePct = avgFirst > 0 ? Math.round(((avgSecond - avgFirst) / avgFirst) * 100) : 0;
        const trend = changePct > 10 ? 'up' : changePct < -10 ? 'down' : 'flat';

        return `## ${metric} Trend (by ${groupBy}, last ${lookback} days)\n\nTrend: ${trend} (${changePct >= 0 ? '+' : ''}${changePct}%)\n\n| Period | Count |\n|--------|-------|\n${trendData.map((r) => `| ${r.period} | ${r.count} |`).join('\n')}`;
      } catch (error) {
        return `Trend analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    default:
      return `Unknown data tool: ${toolName}`;
  }
}
