// Cloudflare Workflows v2 proof-of-concept for Baljia's agent execution pattern.
// Uses REAL Gemini LLM calls to validate end-to-end behavior inside Workflow steps.
//
// Purpose: prove Workflows can orchestrate a multi-step, long-running, DB-writing task
// with checkpointing — the pattern needed for Baljia's 4-hour agent tasks.
//
// Each step makes a real Gemini API call (fetch() from inside CF Workers runtime).

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

interface Env {
  AGENT_EXECUTION_WORKFLOW: Workflow;
  GEMINI_API_KEY: string;
}

interface AgentExecutionParams {
  taskId: string;
  companyId: string;
  userPrompt: string;       // what the "user" is asking the agent to do
  // WORKAROUND: wrangler dev doesn't pass [vars] to Workflows — pass key via params for spike.
  // Production would use wrangler secret put or the Workflow env pattern.
  geminiApiKey: string;
}

// Helper: call Gemini 2.0 Flash (real LLM, real network, real tokens)
async function callGemini(apiKey: string, prompt: string): Promise<{ text: string; latency_ms: number; tokens_in: number; tokens_out: number }> {
  const start = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  return {
    text,
    latency_ms: Date.now() - start,
    tokens_in: data.usageMetadata?.promptTokenCount ?? 0,
    tokens_out: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// The Workflow — mimics the shape of worker-launcher.launchTask()
// but with 3 REAL LLM calls (plan → execute → verify)
export class AgentExecutionWorkflow extends WorkflowEntrypoint<Env, AgentExecutionParams> {
  async run(event: WorkflowEvent<AgentExecutionParams>, step: WorkflowStep) {
    const { taskId, companyId, userPrompt, geminiApiKey } = event.payload;
    const apiKey = geminiApiKey;

    if (!apiKey || apiKey === 'placeholder') {
      throw new Error('geminiApiKey param not set');
    }

    // ── Step 1: Load task context (simulated — no DB for standalone POC) ──
    const taskContext = await step.do('load-task-context', async () => {
      return {
        task_id: taskId,
        company_id: companyId,
        user_prompt: userPrompt,
        loaded_at: new Date().toISOString(),
      };
    });

    // ── Step 2: REAL LLM call — agent PLANS its approach ──
    const planResult = await step.do('agent-plan', async () => {
      const planPrompt = `You are a task-planning agent. A user asked: "${userPrompt}". Break this into 2-3 short bullet points describing how you'd tackle it. Be concise (under 60 words total).`;
      return await callGemini(apiKey, planPrompt);
    });

    // ── Step 3: REAL LLM call — agent EXECUTES the plan ──
    const executeResult = await step.do('agent-execute', async () => {
      const executePrompt = `You are executing this plan:\n${planResult.text}\n\nProduce a brief, concrete output (under 80 words) that accomplishes the original user request: "${userPrompt}"`;
      return await callGemini(apiKey, executePrompt);
    });

    // ── Step 4: REAL LLM call — agent VERIFIES its own output ──
    const verifyResult = await step.do('agent-verify', async () => {
      const verifyPrompt = `User asked: "${userPrompt}"\nAgent produced: "${executeResult.text}"\nDid the output satisfy the request? Answer in one word: PASS or FAIL, followed by a 10-word reason.`;
      return await callGemini(apiKey, verifyPrompt);
    });

    // ── Step 5: Persist result (simulated DB write) ──
    const persisted = await step.do('persist-result', async () => {
      return {
        task_id: taskId,
        persisted_at: new Date().toISOString(),
        verdict: verifyResult.text,
      };
    });

    // Aggregate cost + latency
    const total_latency_ms = planResult.latency_ms + executeResult.latency_ms + verifyResult.latency_ms;
    const total_tokens_in = planResult.tokens_in + executeResult.tokens_in + verifyResult.tokens_in;
    const total_tokens_out = planResult.tokens_out + executeResult.tokens_out + verifyResult.tokens_out;

    return {
      task_id: taskId,
      status: 'completed',
      user_prompt: userPrompt,
      plan: planResult.text,
      output: executeResult.text,
      verification: verifyResult.text,
      performance: {
        total_llm_latency_ms: total_latency_ms,
        total_tokens_in,
        total_tokens_out,
        llm_calls: 3,
      },
    };
  }
}

// HTTP endpoint to trigger a Workflow (mimics POST /api/worker/launch in real code)
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const body = (await request.json()) as Partial<AgentExecutionParams>;
      const params: AgentExecutionParams = {
        taskId: body.taskId ?? `test-${Date.now()}`,
        companyId: body.companyId ?? 'test-company',
        userPrompt: body.userPrompt ?? 'Write a one-sentence tagline for a coffee shop.',
        // Fetch handler CAN read [vars] env — pass through to Workflow via params
        geminiApiKey: env.GEMINI_API_KEY,
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
      'POST /trigger { taskId?, companyId?, userPrompt? }\nGET /status?id=...',
      { status: 200 }
    );
  },
};
