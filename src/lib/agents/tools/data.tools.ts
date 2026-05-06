// Data Agent Tools — migrated to Drizzle + Neon
import type { Task } from '@/types';
import { db, tasks as tasksTable, creditLedger, platformEvents } from '@/lib/db';
import { eq, gte, and, sql } from 'drizzle-orm';
import { getCompanyDatabase } from '@/lib/services/neon.service';

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
    // ── Founder's Product Database (shared with Engineering) ──
    {
      name: 'query_company_db',
      description: 'Run a read-only SELECT query on the founder\'s product database (Neon Postgres). Use for real analytics on their users, orders, events — not Baljia platform tables.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' as const, description: 'SQL SELECT query (read-only)' },
        },
        required: ['sql'],
      },
    },
    {
      name: 'get_database_info',
      description: "Get the founder's product database connection details and schema overview.",
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    // ── Infra Visibility (read-only, shared with Engineering) ──
    {
      name: 'get_company_tech',
      description: 'Get current tech setup for this company: GitHub repo, Render service, Neon DB. Use to understand what infrastructure exists.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'render_get_logs',
      description: 'Get Render deploy/runtime logs for this company founder app. Use after get_company_tech to diagnose failing Render services.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID (from get_company_tech)' },
          log_type: { type: 'string' as const, enum: ['service', 'deploy'], description: 'service for runtime logs, deploy for latest deploy logs.' },
          num_lines: { type: 'number' as const, description: 'Number of log lines (default: 100, max: 500)' },
        },
        required: ['service_id'],
      },
    },
    {
      name: 'get_service_status',
      description: 'One-shot health check for the founder\'s deployed app: combines Render service state + URL liveness in a single call. Faster than running get_company_tech + check_url_health separately. Returns OK / DEGRADED / DOWN with details.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Optional Render service ID. If omitted, uses the company\'s primary render_service_id.' },
        },
      },
    },
    {
      name: 'list_company_services',
      description: 'List all Render services associated with this company (web services, background workers, static sites). Returns service IDs, names, types, and live URLs.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_preview_url',
      description: 'Get the founder\'s live app URL in one call (no JSON blob to parse). Returns the deployed URL for their primary Render service, or null if not deployed yet.',
      input_schema: {
        type: 'object' as const,
        properties: {},
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

      // C-SEC-004: Comprehensive SQL injection prevention
      // 1. Block all mutation keywords — even inside subqueries or CTEs
      const MUTATION_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|SET)\b/i;
      if (MUTATION_KEYWORDS.test(query)) {
        return 'ERROR: Only SELECT queries are allowed. Data agent has read-only access.';
      }

      // 2. Block semicolons to prevent statement chaining
      if (query.includes(';')) {
        return 'ERROR: Multiple statements are not allowed. Send a single SELECT query.';
      }

      // 3. Block dangerous constructs
      const DANGEROUS_PATTERNS = /\b(pg_sleep|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|copy\s+to|INTO\s+OUTFILE)\b/i;
      if (DANGEROUS_PATTERNS.test(query)) {
        return 'ERROR: Query contains banned function or construct.';
      }

      // 4. Query length limit (prevent resource exhaustion)
      if (query.length > 2000) {
        return 'ERROR: Query too long. Maximum 2000 characters.';
      }

      // 5. Must start with SELECT (no CTEs/WITH)
      if (!/^SELECT\b/i.test(query)) {
        return 'ERROR: Query must start with SELECT. CTEs (WITH) and other constructs are not supported.';
      }

      // 6. Enforce tenant scoping: query MUST explicitly filter by this company_id without OR
      const companyId = task.company_id;
      if (!query.includes(companyId)) {
        return `ERROR: Query must filter by company_id = '${companyId}'. Cross-tenant queries are not allowed.`;
      }
      if (/\bOR\b/i.test(query)) {
        return `ERROR: OR conditions are not permitted in data queries for security.`;
      }
      if (/--|\/\*/.test(query)) {
        return `ERROR: SQL comments are not permitted in data queries for security.`;
      }

      try {
        // Use parameterized timeout + read-only transaction
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = '5000'`);
          await tx.execute(sql`SET TRANSACTION READ ONLY`);
          return tx.execute(sql.raw(query));
        });
        const rows = result.rows ?? [];
        return `Query returned ${rows.length} rows:\n${JSON.stringify(rows.slice(0, 50), null, 2)}${rows.length > 50 ? '\n... (truncated, showing first 50)' : ''}`;
      } catch (error) {
        return `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'inspect_schema': {
      try {
        if (input.table_name) {
          // H-SEC-002: Parameterized query (no string interpolation for user input)
          const tableName = String(input.table_name).replace(/[^a-zA-Z0-9_]/g, '');
          const cols = await db.execute(sql`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${tableName}
            ORDER BY ordinal_position
          `);
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

    // ── Founder's product database ──
    case 'query_company_db': {
      const querySql = (input.sql as string)?.trim();
      if (!querySql) return 'Error: sql query is required.';
      if (!/^SELECT\b/i.test(querySql)) return 'Error: Only SELECT queries allowed on the product database.';
      if (/;/.test(querySql)) return 'Error: Multiple statements not allowed.';

      const dbInfo = await getCompanyDatabase(task.company_id);
      if (!dbInfo) return 'No product database provisioned yet. Ask the founder to have Engineering provision_database first.';
      if (!dbInfo.connectionUri) return 'Product database exists but connection URI not available.';

      try {
        // CF-compat: use Neon HTTP driver (edge-compatible via fetch, no TCP pg)
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(dbInfo.connectionUri);
        const rows = (await sql.query(querySql)) as Record<string, unknown>[];
        if (rows.length === 0) return 'Query returned 0 rows.';
        return `Query returned ${rows.length} rows:\n${JSON.stringify(rows.slice(0, 50), null, 2)}${rows.length > 50 ? '\n... (first 50 shown)' : ''}`;
      } catch (err) {
        return `Product DB query failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    case 'get_database_info': {
      const dbInfo = await getCompanyDatabase(task.company_id);
      if (!dbInfo) return 'No product database provisioned. Engineering must run provision_database first.';
      return [
        `## Founder Product Database`,
        `Project: ${dbInfo.name}`,
        `Host: ${dbInfo.host}`,
        `Connection: ${dbInfo.connectionUri ? 'Available' : 'Pending'}`,
        '',
        'Use query_company_db to run analytics queries on this database.',
      ].join('\n');
    }

    case 'get_company_tech': {
      const { handleEngineeringTool } = await import('./engineering.tools');
      return handleEngineeringTool('get_company_tech', {}, task);
    }

    case 'render_get_logs': {
      const { handleEngineeringTool } = await import('./engineering.tools');
      return handleEngineeringTool('render_get_logs', input, task);
    }

    case 'get_service_status': {
      const { db, companies } = await import('@/lib/db');
      const { eq } = await import('drizzle-orm');
      const [company] = await db
        .select({ render_service_id: companies.render_service_id, subdomain: companies.subdomain, name: companies.name })
        .from(companies)
        .where(eq(companies.id, task.company_id))
        .limit(1);
      if (!company) return 'Company not found.';

      const serviceId = (input.service_id as string | undefined) ?? company.render_service_id;
      if (!serviceId) {
        return `${company.name} — DOWN (no Render service provisioned yet). Use list_company_services if you expect one.`;
      }

      const { handleEngineeringTool } = await import('./engineering.tools');
      const serviceText = await handleEngineeringTool('render_get_service', { service_id: serviceId }, task);
      const urlMatch = serviceText.match(/https?:\/\/[^\s'")]+/);
      const url = urlMatch?.[0] ?? null;

      let healthLine = 'URL: not found in service info';
      let verdict: 'OK' | 'DEGRADED' | 'DOWN' = 'DEGRADED';
      if (url) {
        const healthText = await handleEngineeringTool('check_url_health', { url }, task);
        const upMatch = /\b(200|2\d\d|status:\s*200)\b/.test(healthText);
        const downMatch = /\b(5\d\d|timeout|unreachable|failed)\b/i.test(healthText);
        verdict = upMatch ? 'OK' : downMatch ? 'DOWN' : 'DEGRADED';
        healthLine = `URL: ${url} → ${verdict}\n${healthText.split('\n').slice(0, 4).join('\n')}`;
      } else {
        verdict = 'DEGRADED';
      }

      return [
        `## ${company.name} — Service Status: ${verdict}`,
        `Service: ${serviceId}`,
        ``,
        `### Render service info`,
        serviceText.split('\n').slice(0, 8).join('\n'),
        ``,
        `### Health`,
        healthLine,
      ].join('\n');
    }

    case 'list_company_services': {
      const { db, companies } = await import('@/lib/db');
      const { eq } = await import('drizzle-orm');
      const [company] = await db
        .select({ render_service_id: companies.render_service_id, name: companies.name })
        .from(companies)
        .where(eq(companies.id, task.company_id))
        .limit(1);
      if (!company) return 'Company not found.';
      if (!company.render_service_id) return `${company.name} has no Render services provisioned yet.`;

      const { handleEngineeringTool } = await import('./engineering.tools');
      // render_list_services lists ALL services on the Render account; we filter
      // to the one(s) tied to this company by service ID. Future: store multiple
      // service IDs per company for full coverage.
      const allServicesText = await handleEngineeringTool('render_list_services', {}, task);
      const ours = allServicesText
        .split('\n')
        .filter((line) => line.includes(company.render_service_id ?? '__never__'));
      if (ours.length === 0) {
        return `${company.name} — primary service ${company.render_service_id} not found in account list.\n\n(Render account services:\n${allServicesText.split('\n').slice(0, 10).join('\n')})`;
      }
      return `## ${company.name} — Render services\n${ours.join('\n')}`;
    }

    case 'get_preview_url': {
      const { db, companies } = await import('@/lib/db');
      const { eq } = await import('drizzle-orm');
      const [company] = await db
        .select({ render_service_id: companies.render_service_id, subdomain: companies.subdomain, name: companies.name })
        .from(companies)
        .where(eq(companies.id, task.company_id))
        .limit(1);
      if (!company) return 'Company not found.';
      if (!company.render_service_id) {
        return `${company.name} — no live URL (Render service not provisioned yet).`;
      }
      const { handleEngineeringTool } = await import('./engineering.tools');
      const serviceText = await handleEngineeringTool('render_get_service', { service_id: company.render_service_id }, task);
      const urlMatch = serviceText.match(/https?:\/\/[^\s'")]+/);
      if (!urlMatch) {
        return `${company.name} — service exists (${company.render_service_id}) but no URL extracted yet. Service may still be deploying.`;
      }
      return `${company.name} — live URL: ${urlMatch[0]}`;
    }

    default:
      return `Unknown data tool: ${toolName}`;
  }
}
