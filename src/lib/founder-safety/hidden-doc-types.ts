// Document doc_types that are internal-only and must never appear in the
// founder-facing dashboard. The `documents` table holds both founder-visible
// docs (mission, market_research, brand_voice, product_overview) and
// internal-machinery docs (codebase_map for engineering agent, possibly
// others later). This list is the single source of truth — every founder-
// visible read MUST filter against it.

export const FOUNDER_HIDDEN_DOC_TYPES = [
  'codebase_map', // Engineering agent's structural map of the deployed app
  'code_graph_report', // Runtime-only Graphify report for engineering navigation
  'code_graph_manifest', // Runtime-only Graphify cache manifest
] as const;

export type FounderHiddenDocType = typeof FOUNDER_HIDDEN_DOC_TYPES[number];

export function isFounderVisibleDocType(docType: string): boolean {
  return !(FOUNDER_HIDDEN_DOC_TYPES as readonly string[]).includes(docType);
}
