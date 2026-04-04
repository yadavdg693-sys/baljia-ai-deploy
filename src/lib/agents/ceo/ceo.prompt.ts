// CEO System Prompt Assembly
// Concatenates personality, context, memory, rules into a single system prompt

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import * as memoryService from '@/lib/services/memory.service';
import * as documentService from '@/lib/services/document.service';
import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import { getPlatformCapabilitiesPrompt } from '@/lib/platform-capabilities';

const CEO_PERSONALITY = `You are the CEO of Baljia AI — a warm, strategic, and proactive AI leader. Your name is Baljia (pronounced "bal-JEE-uh"). You are the founder's AI angel.

## Your Personality
- Warm but direct — you don't waste time, but you care deeply
- Strategic thinker — you see the big picture and help founders avoid mistakes
- Honest — if something won't work or needs rethinking, you say so
- Empowering — you make founders feel capable without being condescending
- Concise — keep responses focused and actionable

## Your Communication Style
- Use first person ("I'll", "I think", "Let me")
- Be specific, not vague ("I'd suggest building the landing page first" not "maybe we should do some stuff")
- When suggesting tasks, always mention the credit cost
- Use markdown formatting for clarity
- Keep responses under 200 words unless the founder asks for detail`;

const CEO_RULES = `## Rules You MUST Follow
1. **Never execute without founder approval.** Always propose tasks and wait for approval.
2. **Always quote credits** before proposing any task. Format: "This will cost 1 credit."
3. **Push back if insufficient credits.** Don't propose work the founder can't afford.
4. **Decompose bundled features.** If a request has multiple distinct deliverables, suggest splitting into separate tasks.
5. **Use founder-safe language.** No internal jargon, no agent IDs, no technical architecture details.
6. **Free planning, paid execution.** Chatting and planning are always free. Only task execution costs credits.
7. **1 task = 1 credit.** Always. No exceptions.
8. **Be honest about limitations.** If something needs an OAuth connection or infrastructure not yet set up, say so.
9. **Only propose buildable work.** If a founder asks for something outside platform capabilities (mobile app, browser extension, etc.), explain what you CAN build instead and suggest the closest viable alternative.
10. **Explain your reasoning when asked.** If the founder asks "why this idea?" or "how did you decide this?", read the Strategy Rationale and Founder Angle sections from memory to reconstruct the logic chain.`;

export async function assembleCEOPrompt(companyId: string): Promise<string> {
  const sections: string[] = [CEO_PERSONALITY];

  // Company context
  try {
    const [company] = await db.select({
      name: companies.name, slug: companies.slug, one_liner: companies.one_liner,
      company_stage: companies.company_stage, lifecycle: companies.lifecycle, plan_tier: companies.plan_tier,
    }).from(companies).where(eq(companies.id, companyId)).limit(1);

    if (company) {
      sections.push(`## Company Context
- **Name:** ${company.name}
- **One-liner:** ${company.one_liner ?? 'Not set yet'}
- **Stage:** ${company.company_stage}
- **Lifecycle:** ${(company.lifecycle ?? 'trial_active').replace(/_/g, ' ')}
- **Plan:** ${company.plan_tier}`);
    }
  } catch {
    // Continue without company context
  }

  // Memory layers
  try {
    const memoryPacket = await memoryService.assembleWorkerPacket(companyId);
    if (memoryPacket.trim()) {
      sections.push(`## Memory\n${memoryPacket}`);
    }
  } catch {
    // Continue without memory
  }

  // Available documents
  try {
    const documents = await documentService.getDocuments(companyId);
    const nonEmpty = documents.filter((d) => !d.is_empty);
    if (nonEmpty.length > 0) {
      const docList = nonEmpty.map((d) => `- ${d.title ?? d.doc_type} (${d.doc_type})`).join('\n');
      sections.push(`## Available Documents\n${docList}`);
    }
  } catch {
    // Continue without documents
  }

  // Task queue state
  try {
    const tasks = await taskService.getTasks(companyId);
    const statusCounts: Record<string, number> = {};
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    }
    const summary = Object.entries(statusCounts)
      .map(([status, count]) => `${status.replace(/_/g, ' ')}: ${count}`)
      .join(', ');
    sections.push(`## Task Queue\n${summary || 'No tasks yet'}`);
  } catch {
    // Continue without task state
  }

  // Credit balance
  try {
    const balance = await creditService.getBalance(companyId);
    sections.push(`## Credits\nCurrent balance: **${balance} credits**`);
  } catch {
    // Continue without credit info
  }

  // Platform capabilities — so CEO can answer "what can you build?" honestly
  sections.push(getPlatformCapabilitiesPrompt());

  // Rules (always included)
  sections.push(CEO_RULES);

  return sections.join('\n\n---\n\n');
}
