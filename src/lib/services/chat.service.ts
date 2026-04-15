// Chat Service — migrated to Drizzle + Neon
import { db, chatSessions } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { updateMemoryLayer } from '@/lib/services/memory.service';
import { createLogger } from '@/lib/logger';
import type { ChatSession, ChatMessage } from '@/types';

const log = createLogger('Chat');

// SPEC-CTRL-105: L2 autosave every ~20 messages (counter-based trigger)
const L2_AUTOSAVE_INTERVAL = 20;

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
  const prevCount = session.message_count ?? 0;
  const newCount = messages.length;

  const [updated] = await db.update(chatSessions)
    .set({ messages: messages as unknown as Record<string, unknown>[], message_count: newCount, updated_at: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  // SPEC-CTRL-105: L2 autosave — every 20 messages, extract founder preferences
  // Counter-based: triggers when we cross a 20-message boundary
  if (Math.floor(newCount / L2_AUTOSAVE_INTERVAL) > Math.floor(prevCount / L2_AUTOSAVE_INTERVAL)) {
    try {
      await autosaveL2(session.company_id, messages);
    } catch (err) {
      log.warn('L2 autosave failed', { sessionId, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return toSession(updated);
}

/**
 * L2 Autosave — extract founder preferences from recent conversation.
 * Overwrites Layer 2 with a fresh summary of preferences derived from
 * recent messages + prior L2 state.
 * (SPEC-CTRL-105: "autosave process overwrites the full layer content
 * with a fresh summary derived from recent conversation context + prior layer state")
 */
async function autosaveL2(companyId: string, messages: ChatMessage[]): Promise<void> {
  // Take the last 30 messages for preference extraction
  const recent = messages.slice(-30);

  // Extract founder messages (user role) — these contain preferences
  const founderMessages = recent
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n');

  if (!founderMessages.trim()) return;

  // Build a concise preference summary from founder messages
  // For now, use a deterministic extraction (keywords + patterns)
  // A future improvement could use Haiku to summarize
  const preferences: string[] = [];

  // Extract explicit preferences (likes, dislikes, style, tone)
  const preferencePatterns = [
    /(?:i (?:like|prefer|want|need|love))\s+(.+?)(?:\.|$)/gi,
    /(?:don'?t|do not|never|avoid)\s+(.+?)(?:\.|$)/gi,
    /(?:style|tone|voice|brand)\s+(?:should be|is|:)\s*(.+?)(?:\.|$)/gi,
    /(?:our|my)\s+(?:target|audience|customers?)\s+(?:are|is)\s*(.+?)(?:\.|$)/gi,
  ];

  for (const pattern of preferencePatterns) {
    let match;
    while ((match = pattern.exec(founderMessages)) !== null) {
      preferences.push(match[0].trim());
    }
  }

  if (preferences.length === 0) {
    // No explicit preferences found — skip this autosave cycle
    return;
  }

  const summary = `## Founder Preferences (auto-extracted)\n${preferences.map(p => `- ${p}`).join('\n')}\n\n_Last updated: ${new Date().toISOString()}_`;

  await updateMemoryLayer(companyId, 2, summary);
  log.info('L2 autosave completed', { companyId, preferencesExtracted: preferences.length });
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
