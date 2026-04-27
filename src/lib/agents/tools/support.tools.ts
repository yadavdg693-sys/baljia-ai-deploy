// Support Agent Tools — migrated to Drizzle + Neon
import type { Task } from '@/types';
import { db, emailThreads, platformEvents, companies, users, tasks as tasksTable, contacts } from '@/lib/db';
import { eq, and, desc, ilike, or, inArray } from 'drizzle-orm';
import { sendEmail, sendEscalationEmail } from '@/lib/services/email.service';

/** Look up the company's outbound email address (set during onboarding —
 *  e.g. threadmint@baljia.app). Falls back to the generic support@ if the
 *  column is null, but every onboarded company should have it set. */
async function getCompanyOutboundFrom(companyId: string): Promise<string> {
  const [row] = await db
    .select({ company_email: companies.company_email })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.company_email || 'support@baljia.app';
}

export function getSupportTools() {
  return [
    {
      name: 'get_inbox',
      description: 'Get recent inbound emails for the company inbox.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max emails to return (default: 10)' },
          unread_only: { type: 'boolean' as const, description: 'Only unread emails (default: true)' },
        },
      },
    },
    {
      name: 'send_email',
      description: 'Send an email from the company inbox. Plain-text only, match incoming message length.',
      input_schema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string' as const, description: 'Recipient email address' },
          subject: { type: 'string' as const, description: 'Email subject' },
          body: { type: 'string' as const, description: 'Plain-text email body (50-200 words)' },
          reply_to_thread_id: { type: 'string' as const, description: 'Thread ID if replying to existing thread' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'get_email_thread',
      description: 'Get the full email thread by thread ID.',
      input_schema: {
        type: 'object' as const,
        properties: {
          thread_id: { type: 'string' as const, description: 'Thread ID to retrieve' },
        },
        required: ['thread_id'],
      },
    },
    {
      name: 'escalate_to_owner',
      description: 'Escalate an issue to the company owner.',
      input_schema: {
        type: 'object' as const,
        properties: {
          urgency: { type: 'string' as const, description: '"high", "medium", or "low"' },
          summary: { type: 'string' as const, description: 'Brief summary of the issue' },
          customer_email: { type: 'string' as const, description: 'Customer email (if applicable)' },
        },
        required: ['urgency', 'summary'],
      },
    },
    {
      name: 'escalate_to_engineering',
      description: 'Create an Engineering task for a technical issue found during support.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Bug/issue title' },
          description: { type: 'string' as const, description: 'Steps to reproduce, expected vs actual' },
          priority: { type: 'number' as const, description: 'Priority 1-100 (default: 50)' },
        },
        required: ['title', 'description'],
      },
    },
    {
      name: 'get_contacts',
      description: 'Search customer contacts by email or name.',
      input_schema: {
        type: 'object' as const,
        properties: {
          search: { type: 'string' as const, description: 'Search term (email or name)' },
        },
        required: ['search'],
      },
    },
    {
      name: 'wait_for_email',
      description: 'Check for new inbound emails matching specified criteria. Returns matching emails or a message to check again later.',
      input_schema: {
        type: 'object' as const,
        properties: {
          from_address: { type: 'string' as const, description: 'Filter by sender email address (partial match)' },
          subject_contains: { type: 'string' as const, description: 'Filter by subject line containing this text' },
        },
      },
    },
    {
      name: 'add_contact',
      description: 'Add a new contact (customer or lead) discovered during support. Saves name, email, and initial status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Contact full name' },
          email: { type: 'string' as const, description: 'Contact email address' },
          notes: { type: 'string' as const, description: 'Optional context or notes about this contact' },
          lead_status: { type: 'string' as const, description: 'Status: pending, contacted, replied, customer (default: pending)' },
        },
        required: ['email'],
      },
    },
  ];
}

export async function handleSupportTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    case 'get_inbox': {
      const limit = Math.min((input.limit as number) ?? 10, 50);
      const unreadOnly = input.unread_only !== false; // default true per contract
      const conditions = [eq(emailThreads.company_id, task.company_id), eq(emailThreads.direction, 'inbound')];
      if (unreadOnly) conditions.push(eq(emailThreads.is_read, false));
      const data = await db.select().from(emailThreads)
        .where(and(...conditions))
        .orderBy(desc(emailThreads.created_at)).limit(limit);

      if (data.length === 0) return 'Inbox is empty. No inbound emails to process.';

      // Mark these emails as read so the agent doesn't loop on the same
      // batch on the next turn. Fire-and-forget — a failed update just
      // means the agent re-processes them, which is annoying but not wrong.
      if (unreadOnly) {
        const ids = data.map((e) => e.id);
        db.update(emailThreads)
          .set({ is_read: true })
          .where(inArray(emailThreads.id, ids))
          .catch(() => { /* logged inside Drizzle */ });
      }

      return data
        .map((e) => `- thread_id=${e.thread_id ?? e.id} | From: ${e.from_address} | Subject: ${e.subject ?? '(no subject)'} | ${e.created_at}\n  Body: ${(e.body ?? '').slice(0, 300)}`)
        .join('\n');
    }

    case 'send_email': {
      try {
        // Send from the company's verified address (e.g. threadmint@baljia.app)
        // so replies thread correctly and the recipient sees a coherent identity.
        const fromAddress = await getCompanyOutboundFrom(task.company_id);
        const { messageId } = await sendEmail({
          to: input.to as string,
          from: fromAddress,
          subject: input.subject as string,
          textBody: input.body as string,
          companyId: task.company_id,
          threadId: (input.reply_to_thread_id as string) ?? undefined,
        });
        return `Email sent from ${fromAddress} to ${input.to}: "${input.subject}" (messageId: ${messageId})`;
      } catch (err) {
        return `Failed to send email: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    case 'get_email_thread': {
      const data = await db.select().from(emailThreads)
        .where(and(eq(emailThreads.company_id, task.company_id), eq(emailThreads.thread_id, input.thread_id as string)))
        .orderBy(emailThreads.created_at);

      if (data.length === 0) return `No messages found in thread ${input.thread_id}`;
      return data.map((e) => `[${e.direction}] ${e.from_address} → ${e.to_address}\n${e.body ?? '(empty)'}\n---`).join('\n');
    }

    case 'escalate_to_owner': {
      await db.insert(platformEvents).values({
        company_id: task.company_id, event_type: 'support_escalation',
        payload: { type: 'support_escalation', urgency: input.urgency, summary: input.summary, customer_email: input.customer_email ?? null, from_task: task.id },
        is_public_safe: false,
      });

      const [company] = await db.select({ owner_id: companies.owner_id }).from(companies).where(eq(companies.id, task.company_id)).limit(1);
      if (company?.owner_id) {
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, company.owner_id)).limit(1);
        if (user?.email) {
          await sendEscalationEmail(user.email, `[${input.urgency?.toString().toUpperCase()}] Support escalation`, `${input.summary}\n\nCustomer: ${input.customer_email ?? 'Unknown'}`, task.company_id).catch(() => {});
        }
      }
      return `Escalated to owner (urgency: ${input.urgency}): ${input.summary}`;
    }

    case 'escalate_to_engineering': {
      const [newTask] = await db.insert(tasksTable).values({
        company_id: task.company_id, title: input.title as string, description: input.description as string,
        tag: 'bug-fix', priority: (input.priority as number) ?? 50, source: 'auto_remediation',
        status: 'todo', queue_order: 999, estimated_credits: 1, max_turns: 200,
        executability_type: 'can_run_now', related_task_ids: [task.id],
      }).returning({ id: tasksTable.id });

      return `Engineering task created (ID: ${newTask.id}): "${input.title}" — awaiting founder approval.`;
    }

    case 'get_contacts': {
      const search = input.search as string;
      const data = await db.select().from(contacts)
        .where(and(
          eq(contacts.company_id, task.company_id),
          or(ilike(contacts.email, `%${search}%`), ilike(contacts.name, `%${search}%`))
        )).limit(10);

      if (data.length === 0) return `No contacts found matching "${search}"`;
      return data.map((c) => `- ${c.name ?? 'Unknown'} <${c.email}> | Status: ${c.lead_status} | Source: ${c.source ?? 'unknown'}`).join('\n');
    }

    case 'wait_for_email': {
      // A7 FIX: Polling-based email check (no setTimeout — serverless safe)
      const conditions = [
        eq(emailThreads.company_id, task.company_id),
        eq(emailThreads.direction, 'inbound'),
        eq(emailThreads.is_read, false),
      ];

      if (input.from_address) {
        conditions.push(ilike(emailThreads.from_address, `%${input.from_address as string}%`));
      }
      if (input.subject_contains) {
        conditions.push(ilike(emailThreads.subject, `%${input.subject_contains as string}%`));
      }

      const data = await db.select().from(emailThreads)
        .where(and(...conditions))
        .orderBy(desc(emailThreads.created_at))
        .limit(5);

      if (data.length === 0) {
        return 'No matching email found yet. Check again later or proceed without waiting.';
      }

      return `Found ${data.length} matching email(s):\n` +
        data.map((e) => `- From: ${e.from_address} | Subject: ${e.subject ?? '(no subject)'} | ${e.created_at}`).join('\n');
    }

    case 'add_contact': {
      try {
        await db.insert(contacts).values({
          company_id: task.company_id,
          email: input.email as string,
          name: (input.name as string) ?? null,
          lead_status: (input.lead_status as string) ?? 'pending',
          source: 'support',
        }).onConflictDoUpdate({
          target: [contacts.company_id, contacts.email],
          set: {
            name: (input.name as string) ?? undefined,
            lead_status: (input.lead_status as string) ?? undefined,
          },
        });
        return `Contact saved: ${input.name ?? input.email} <${input.email}>${input.notes ? ` | Notes: ${input.notes}` : ''}`;
      } catch (err) {
        return `Failed to add contact: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    default:
      return `Unknown support tool: ${toolName}`;
  }
}
