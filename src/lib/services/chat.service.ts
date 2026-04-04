// Chat Service — migrated to Drizzle + Neon
import { db, chatSessions } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import type { ChatSession, ChatMessage } from '@/types';

// B3 FIX: Safe JSONB→ChatMessage[] extraction with runtime validation
function parseMessages(raw: unknown): ChatMessage[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ChatMessage[];
  // Handle case where JSONB is returned as a string
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ChatMessage[]; } catch { return []; }
  }
  return [];
}

// B3 FIX: Map Drizzle row to ChatSession type without unsafe double-casting
function toSession(row: typeof chatSessions.$inferSelect): ChatSession {
  return {
    id: row.id,
    company_id: row.company_id,
    user_id: row.user_id,
    messages: parseMessages(row.messages),
    message_count: row.message_count ?? 0,
    is_active: row.is_active ?? true,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function getOrCreateSession(
  companyId: string,
  userId: string
): Promise<ChatSession> {
  const [existing] = await db.select().from(chatSessions)
    .where(and(
      eq(chatSessions.company_id, companyId),
      eq(chatSessions.user_id, userId),
      eq(chatSessions.is_active, true)
    ))
    .orderBy(desc(chatSessions.created_at))
    .limit(1);

  if (existing) return toSession(existing);

  const [session] = await db.insert(chatSessions).values({
    company_id: companyId,
    user_id: userId,
    messages: [],
    message_count: 0,
    is_active: true,
  }).returning();

  return toSession(session);
}

export async function appendMessage(
  sessionId: string,
  message: ChatMessage
): Promise<ChatSession> {
  return appendMessages(sessionId, [message]);
}

export async function appendMessages(
  sessionId: string,
  newMessages: ChatMessage[]
): Promise<ChatSession> {
  const [session] = await db.select().from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  if (!session) throw new Error('Chat session not found');

  const messages = [...parseMessages(session.messages), ...newMessages];

  const [updated] = await db.update(chatSessions)
    .set({ messages, message_count: messages.length, updated_at: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  return toSession(updated);
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  const [session] = await db.select({ messages: chatSessions.messages })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  return parseMessages(session?.messages);
}

export async function closeSession(sessionId: string): Promise<void> {
  await db.update(chatSessions)
    .set({ is_active: false, updated_at: new Date() })
    .where(eq(chatSessions.id, sessionId));
}
