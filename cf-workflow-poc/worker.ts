// Cloudflare Workflows v2 proof-of-concept for Baljia's agent execution pattern.
// This mimics the SHAPE of worker-launcher.launchTask() as CF Workflow steps.
//
// Purpose: prove Workflows can orchestrate a multi-step, long-running, DB-writing task
// with checkpointing — the pattern needed for Baljia's 4-hour agent tasks.
//
// NOT the real Baljia agent — just a minimal demonstration.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

// Env shape — in real migration, these would come from wrangler.toml bindings
interface Env {
  AGENT_EXECUTION_WORKFLOW: Workflow;
  DATABASE_URL?: string;
}

// Input to each workflow instance — mirrors Baljia's { taskId }
interface AgentExecutionParams {
  taskId: string;
  companyId: string;
  mockAgentSteps: number;  // simulate N LLM turns
}

// The Workflow class — mimics the SHAPE of worker-launcher.launchTask()
export class AgentExecutionWorkflow extends WorkflowEntrypoint<Env, AgentExecutionParams> {
  async run(event: WorkflowEvent<AgentExecutionParams>, step: WorkflowStep) {
    const { taskId, companyId, mockAgentSteps } = event.payload;

    // ── Step 1: Load task (mirrors taskService.getTask() in real code) ──
    const task = await step.do('load-task', async () => {
      return { id: taskId, company_id: companyId, status: 'todo' };
    });

    // ── Step 2: Lifecycle check (G-BILL-001 in real code) ──
    await step.do('check-lifecycle', async () => {
      // In real code: verify company.lifecycle allows execution
      return { allowed: true };
    });

    // ── Step 3: Claim slot + deduct credit (creditService.claimSlotAndCharge) ──
    await step.do('claim-slot-and-charge', async () => {
      // In real code: atomic DB operation
      return { charged: 1, taskId: task.id };
    });

    // ── Step 4: Agent execution loop — simulated as N sub-steps ──
    // This is the BIG one — multiple steps, each can be ~5min CPU if needed
    // In real code: this is executeAgent() running the tool-use loop
    const agentResults: Array<{ turn: number; toolUsed: string; elapsed_ms: number }> = [];
    for (let turn = 1; turn <= mockAgentSteps; turn++) {
      const result = await step.do(`agent-turn-${turn}`, async () => {
        const start = Date.now();
        // Simulate LLM call (mostly I/O wait, low CPU) — 1 second sleep
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
          turn,
          toolUsed: `mock_tool_${turn}`,
          elapsed_ms: Date.now() - start,
        };
      });
      agentResults.push(result);
    }

    // ── Step 5: Verification (verifyAndUpdate in real code) ──
    const verification = await step.do('verify', async () => {
      return { passed: true, turns_run: agentResults.length };
    });

    // ── Step 6: Write TaskExecution to DB (mirrors taskExecutions insert) ──
    await step.do('persist-result', async () => {
      return {
        taskId,
        completed_at: new Date().toISOString(),
        agent_turns: agentResults.length,
      };
    });

    return {
      taskId,
      status: 'completed',
      verification,
      agent_turns: agentResults,
    };
  }
}

// HTTP endpoint to trigger a Workflow instance (mimics POST /api/worker/launch)
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const body = (await request.json()) as Partial<AgentExecutionParams>;
      const params: AgentExecutionParams = {
        taskId: body.taskId ?? `test-${Date.now()}`,
        companyId: body.companyId ?? 'test-company',
        mockAgentSteps: body.mockAgentSteps ?? 3,
      };

      const instance = await env.AGENT_EXECUTION_WORKFLOW.create({ params });

      return Response.json({
        ok: true,
        instance_id: instance.id,
        status: await instance.status(),
        triggered_with: params,
      });
    }

    if (url.pathname === '/status') {
      const id = url.searchParams.get('id');
      if (!id) return new Response('id required', { status: 400 });
      const instance = await env.AGENT_EXECUTION_WORKFLOW.get(id);
      const status = await instance.status();
      return Response.json({ instance_id: id, status });
    }

    return new Response(
      'POST /trigger { taskId?, companyId?, mockAgentSteps? }\nGET /status?id=...',
      { status: 200 }
    );
  },
};
