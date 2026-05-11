// Document Service — migrated to Drizzle + Neon
import { db, documents, documentSuggestions } from '@/lib/db';
import { eq, and, asc, sql } from 'drizzle-orm';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import { stripLlmArtifacts } from '@/lib/text/llm-artifacts';
import type { Document, DocumentSuggestion } from '@/types';

export async function getDocuments(companyId: string): Promise<Document[]> {
  return db.select().from(documents)
    .where(eq(documents.company_id, companyId))
    .orderBy(asc(documents.created_at)) as unknown as Promise<Document[]>;
}

export async function getPopulatedDocuments(companyId: string): Promise<Document[]> {
  return db.select().from(documents)
    .where(and(
      eq(documents.company_id, companyId),
      eq(documents.is_empty, false)
    ))
    .orderBy(asc(documents.created_at)) as unknown as Promise<Document[]>;
}

export async function getDocument(documentId: string): Promise<Document | null> {
  const [doc] = await db.select().from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  return (doc as unknown as Document) ?? null;
}

export async function getDocumentByType(companyId: string, docType: string): Promise<Document | null> {
  const [doc] = await db.select().from(documents)
    .where(and(
      eq(documents.company_id, companyId),
      eq(documents.doc_type, docType)
    ))
    .limit(1);

  return (doc as unknown as Document) ?? null;
}

/**
 * Update document content with atomic version increment.
 * Drizzle supports SQL expressions, so we can do version + 1 in one query.
 *
 * Founder-safety: audit-mode scan. Documents (market research, mission,
 * landing HTML) legitimately describe competitor products — mangling them
 * would be worse than a rare infra-phrase leak. Audit mode logs violations
 * to Sentry without modifying content so we catch regressions at source.
 */
export async function updateDocument(documentId: string, content: string): Promise<Document> {
  sanitizeForFounder(content, {
    mode: 'audit',
    context: { callsite: 'documentService.updateDocument', documentId },
  });

  // Defense in depth: documents are rendered as markdown (mission, market
  // research), so **bold**, *italic*, headings, and lists must survive —
  // they're intentional formatting. Only em/en-dashes (always an AI tell)
  // get stripped here.
  const cleaned = stripLlmArtifacts(content, {
    keepLineStructure: true,
    preserveMarkdown: true,
  });

  const [doc] = await db.update(documents)
    .set({
      content: cleaned,
      is_empty: cleaned.trim().length === 0,
      version: sql`${documents.version} + 1`,
      updated_at: new Date(),
    })
    .where(eq(documents.id, documentId))
    .returning();

  if (!doc) throw new Error('Failed to update document: not found');
  return doc as unknown as Document;
}

export async function createSuggestion(input: {
  document_id: string;
  company_id: string;
  suggested_content: string;
  reasoning?: string;
  source_task_id?: string;
}): Promise<DocumentSuggestion> {
  const [suggestion] = await db.insert(documentSuggestions).values({
    document_id: input.document_id,
    company_id: input.company_id,
    suggested_content: input.suggested_content,
    reason: input.reasoning ?? null,
    task_id: input.source_task_id ?? null,
    status: 'pending',
  }).returning();

  return suggestion as unknown as DocumentSuggestion;
}

export async function getPendingSuggestions(companyId: string): Promise<DocumentSuggestion[]> {
  return db.select().from(documentSuggestions)
    .where(and(
      eq(documentSuggestions.company_id, companyId),
      eq(documentSuggestions.status, 'pending')
    ))
    .orderBy(asc(documentSuggestions.created_at)) as unknown as Promise<DocumentSuggestion[]>;
}

export async function reviewSuggestion(
  suggestionId: string,
  action: 'accept' | 'edit' | 'skip',
  editedContent?: string
): Promise<void> {
  if (action === 'accept' || action === 'edit') {
    const [suggestion] = await db.select().from(documentSuggestions)
      .where(eq(documentSuggestions.id, suggestionId))
      .limit(1);

    if (!suggestion) throw new Error('Suggestion not found');

    const content = action === 'edit' && editedContent
      ? editedContent
      : suggestion.suggested_content;

    await updateDocument(suggestion.document_id, content);
  }

  const statusMap = { accept: 'accepted', edit: 'edited', skip: 'skipped' } as const;
  await db.update(documentSuggestions)
    .set({ status: statusMap[action], reviewed_at: new Date() })
    .where(eq(documentSuggestions.id, suggestionId));
}
