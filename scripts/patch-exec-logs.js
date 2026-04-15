const fs = require('fs');
const file = 'src/lib/agents/ceo/ceo.tool-handlers.ts';
let content = fs.readFileSync(file, 'utf8');

// Match the old function
const pattern = /async function handleGetTaskExecutionLogs[\s\S]*?catch \{ return \{ content: 'Could not retrieve execution logs\.' \}; \}\r?\n\}/;
const match = content.match(pattern);
if (!match) {
  console.error('handleGetTaskExecutionLogs not found');
  process.exit(1);
}

const newFn = [
  'async function handleGetTaskExecutionLogs(input: Record<string, unknown>, companyId: string): Promise<ToolResult> {',
  '  const taskId = input.task_id as string;',
  '  try {',
  '    const task = await taskService.getTask(taskId);',
  '    if (!task || task.company_id !== companyId) return { content: \'Task not found.\' };',
  '',
  '    const [execution] = await db.select({',
  '      execution_log: taskExecutions.execution_log,',
  '      turn_count: taskExecutions.turn_count,',
  '      agent_id: taskExecutions.agent_id,',
  '    }).from(taskExecutions)',
  '      .where(eq(taskExecutions.task_id, taskId))',
  '      .orderBy(desc(taskExecutions.started_at))',
  '      .limit(1);',
  '',
  '    if (!execution?.execution_log) return { content: \'No execution logs available for this task.\' };',
  '',
  '    const logs = execution.execution_log as Array<Record<string, unknown>>;',
  '',
  '    // GUARDRAIL: only surface human-readable events — never raw tool names or API responses',
  '    const safeEvents = logs.filter(entry => {',
  "      const event = String(entry.event ?? '');",
  "      return ['task_started','task_completed','task_failed','progress','message','error_summary'].includes(event)",
  "        || typeof entry.message === 'string';",
  '    });',
  '',
  '    if (!safeEvents.length) {',
  '      return {',
  '        content: `## Task Execution Summary\\n- Agent: ${getAgentName(execution.agent_id)}\\n- Turns used: ${execution.turn_count ?? \'unknown\'}\\n- Status: ${task.status}\\n\\nNo step-by-step detail available.`,',
  '      };',
  '    }',
  '',
  '    const summary = safeEvents.slice(-10).map((entry, i) => {',
  "      const event = entry.event ?? entry.message ?? '';",
  '      return `${i + 1}. ${String(event).substring(0, 150)}`;',
  '    }).join(\'\\n\');',
  '',
  '    return { content: `## Task Execution Summary (${execution.turn_count} turns)\\n${summary}` };',
  "  } catch { return { content: 'Could not retrieve execution logs.' }; }",
  '}',
].join('\n');

content = content.replace(match[0], newFn);
fs.writeFileSync(file, content, 'utf8');
console.log('handleGetTaskExecutionLogs hardened successfully');
