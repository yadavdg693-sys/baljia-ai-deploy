// Cold Outreach Agent Tools — migrated to Drizzle + Neon
import type { Task } from '@/types';
import { db, emailThreads, contacts } from '@/lib/db';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/services/email.service';

// Lead state machine
const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ['contacted'],
  contacted: ['qualified', 'lost'],
  qualified: ['converted', 'lost'],
  converted: [],
  lost: [],
  unsubscribed: [],
};

export function getOutreachTools() {
  return [
    {
      name: 'find_email',
      description: 'Find email address for a person at a company using Hunter.io.',
      input_schema: {
        type: 'object' as const,
        properties: {
          full_name: { type: 'string' as const, description: 'Person\'s full name' },
          domain: { type: 'string' as const, description: 'Company domain (e.g., "example.com")' },
        },
        required: ['full_name', 'domain'],
      },
    },
    {
      name: 'verify_email',
      description: 'Verify if an email address is deliverable before sending.',
      input_schema: {
        type: 'object' as const,
        properties: { email: { type: 'string' as const, description: 'Email address to verify' } },
        required: ['email'],
      },
    },
    {
      name: 'send_outreach_email',
      description: 'Send a cold outreach email. Plain-text, 50-125 words, founder-style voice.',
      input_schema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string' as const, description: 'Recipient email' },
          subject: { type: 'string' as const, description: 'Email subject' },
          body: { type: 'string' as const, description: 'Plain-text body (50-125 words)' },
          personalization_hook: { type: 'string' as const, description: 'What makes this relevant (REQUIRED)' },
        },
        required: ['to', 'subject', 'body', 'personalization_hook'],
      },
    },
    {
      name: 'check_replies',
      description: 'Check for inbound replies to outreach emails.',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'add_contact',
      description: 'Add a new contact/lead to the CRM.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Contact full name' },
          email: { type: 'string' as const, description: 'Contact email' },
          source: { type: 'string' as const, description: 'Lead source' },
        },
        required: ['email'],
      },
    },
    {
      name: 'update_contact_status',
      description: 'Update lead status. States: new → contacted → qualified → converted/lost.',
      input_schema: {
        type: 'object' as const,
        properties: {
          email: { type: 'string' as const, description: 'Contact email' },
          status: { type: 'string' as const, description: 'New status' },
        },
        required: ['email', 'status'],
      },
    },
    {
      name: 'get_contacts',
      description: 'Get contacts filtered by status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string' as const, description: 'Filter by status (optional)' },
          limit: { type: 'number' as const, description: 'Max contacts (default: 20)' },
        },
      },
    },
    {
      name: 'get_outreach_stats',
      description: 'Get outreach statistics: emails sent today, reply rate, pipeline summary.',
      input_schema: { type: 'object' as const, properties: {} },
    },
  ];
}

export async function handleOutreachTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    case 'find_email': {
      const apiKey = process.env.HUNTER_API_KEY;
      if (!apiKey) return `Hunter.io not configured. Cannot find email for ${input.full_name} at ${input.domain}.`;

      try {
        const res = await fetch(`https://api.hunter.io/v2/email-finder?domain=${input.domain}&full_name=${encodeURIComponent(input.full_name as string)}&api_key=${apiKey}`);
        const data = await res.json() as { data?: { email: string; confidence: number } };
        if (data.data?.email) return `Found email: ${data.data.email} (confidence: ${data.data.confidence}%)`;
        return `Could not find email for ${input.full_name} at ${input.domain}.`;
      } catch (error) {
        return `Hunter.io search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'verify_email': {
      const apiKey = process.env.HUNTER_API_KEY;
      if (!apiKey) return `Hunter.io not configured. Cannot verify ${input.email}.`;

      try {
        const res = await fetch(`https://api.hunter.io/v2/email-verifier?email=${input.email}&api_key=${apiKey}`);
        const data = await res.json() as { data?: { status: string; result: string } };
        return `Email ${input.email} verification: ${data.data?.status ?? 'unknown'} (${data.data?.result ?? 'unknown'})`;
      } catch (error) {
        return `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    case 'send_outreach_email': {
      const body = input.body as string;
      const wordCount = body.split(/\s+/).length;
      if (wordCount < 30) return `Email too short (${wordCount} words). Aim for 50-125 words.`;
      if (wordCount > 200) return `Email too long (${wordCount} words). Keep to 50-125 words.`;
      if (!input.personalization_hook) return 'Missing personalization hook.';

      // Check daily limit
      const today = new Date().toISOString().split('T')[0];
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(emailThreads)
        .where(and(
          eq(emailThreads.company_id, task.company_id),
          eq(emailThreads.direction, 'outbound'),
          gte(emailThreads.created_at, new Date(`${today}T00:00:00Z`))
        ));

      if ((countResult?.count ?? 0) >= 2) {
        return `Daily outreach limit reached (${countResult?.count}/2). Wait until tomorrow.`;
      }

      // Store outbound email
      await db.insert(emailThreads).values({
        company_id: task.company_id, direction: 'outbound',
        to_address: input.to as string, from_address: 'outreach@baljia.com',
        subject: input.subject as string, body,
      });

      // Send via Postmark
      let messageId = 'not-sent';
      try {
        const result = await sendEmail({
          to: input.to as string, from: 'outreach@baljia.app',
          subject: input.subject as string, textBody: body,
          companyId: task.company_id, tag: 'cold-outreach',
        });
        messageId = result.messageId;
      } catch (sendErr) {
        return `Email logged but send failed: ${sendErr instanceof Error ? sendErr.message : 'Unknown error'}`;
      }

      // Update contact status
      await db.update(contacts).set({ lead_status: 'contacted' })
        .where(and(eq(contacts.company_id, task.company_id), eq(contacts.email, input.to as string)));

      return `Outreach email sent to ${input.to} (${wordCount} words, messageId: ${messageId})\nHook: ${input.personalization_hook}`;
    }

    case 'check_replies': {
      const data = await db.select({
        from_address: emailThreads.from_address, subject: emailThreads.subject,
        body: emailThreads.body, created_at: emailThreads.created_at,
      }).from(emailThreads)
        .where(and(eq(emailThreads.company_id, task.company_id), eq(emailThreads.direction, 'inbound')))
        .orderBy(desc(emailThreads.created_at)).limit(10);

      if (!data.length) return 'No inbound replies. Check back later or focus on new leads.';
      return `Inbound replies (${data.length}):\n${data.map((e) =>
        `- From: ${e.from_address} | Subject: ${e.subject ?? '(none)'} | ${e.created_at}\n  Preview: ${(e.body ?? '').substring(0, 100)}`
      ).join('\n')}`;
    }

    case 'add_contact': {
      try {
        await db.insert(contacts).values({
          company_id: task.company_id,
          name: (input.name as string) ?? null,
          email: input.email as string,
          lead_status: 'new',
          email_verified: false,
          source: (input.source as string) ?? null,
        });
        return `Contact added: ${input.name ?? input.email} (status: new)`;
      } catch (error) {
        return `Failed to add contact: ${error instanceof Error ? error.message : 'Unknown'}`;
      }
    }

    case 'update_contact_status': {
      const newStatus = input.status as string;

      const [contact] = await db.select({ lead_status: contacts.lead_status })
        .from(contacts)
        .where(and(eq(contacts.company_id, task.company_id), eq(contacts.email, input.email as string)))
        .limit(1);

      if (!contact) return `Contact ${input.email} not found.`;

      const validNext = VALID_TRANSITIONS[contact.lead_status ?? 'new'] ?? [];
      if (validNext.length > 0 && !validNext.includes(newStatus)) {
        return `Invalid transition: ${contact.lead_status} → ${newStatus}. Valid: ${validNext.join(', ')}`;
      }

      await db.update(contacts).set({ lead_status: newStatus })
        .where(and(eq(contacts.company_id, task.company_id), eq(contacts.email, input.email as string)));

      return `Contact ${input.email} status: ${contact.lead_status} → ${newStatus}`;
    }

    case 'get_contacts': {
      const limit = Math.min((input.limit as number) ?? 20, 50);
      const conditions = [eq(contacts.company_id, task.company_id)];
      if (input.status) conditions.push(eq(contacts.lead_status, input.status as string));

      const data = await db.select().from(contacts)
        .where(and(...conditions)).orderBy(desc(contacts.created_at)).limit(limit);

      if (!data.length) return 'No contacts found.';
      return data.map((c) => `- ${c.name ?? 'Unknown'} <${c.email}> | ${c.lead_status} | Source: ${c.source ?? 'unknown'}`).join('\n');
    }

    case 'get_outreach_stats': {
      const today = new Date().toISOString().split('T')[0];

      const [[sentToday], contactRows, [replyCount]] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(emailThreads)
          .where(and(eq(emailThreads.company_id, task.company_id), eq(emailThreads.direction, 'outbound'), gte(emailThreads.created_at, new Date(`${today}T00:00:00Z`)))),
        db.select({ lead_status: contacts.lead_status }).from(contacts).where(eq(contacts.company_id, task.company_id)),
        db.select({ count: sql<number>`count(*)::int` }).from(emailThreads)
          .where(and(eq(emailThreads.company_id, task.company_id), eq(emailThreads.direction, 'inbound'))),
      ]);

      const statusCounts: Record<string, number> = {};
      for (const c of contactRows) {
        statusCounts[c.lead_status ?? 'unknown'] = (statusCounts[c.lead_status ?? 'unknown'] ?? 0) + 1;
      }

      return `## Outreach Stats
- Sent today: ${sentToday?.count ?? 0}/2
- Total replies: ${replyCount?.count ?? 0}
- Pipeline:\n${Object.entries(statusCounts).map(([s, c]) => `  - ${s}: ${c}`).join('\n') || '  Empty'}`;
    }

    default:
      return `Unknown outreach tool: ${toolName}`;
  }
}
