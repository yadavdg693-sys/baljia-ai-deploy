import { aiRagToolDomain } from './ai-rag.tools';
import { codegraphToolDomain } from './codegraph.tools';
import { designToolDomain } from './design.tools';
import type { EngineeringToolDomain } from './engineering-tool-domain';
import { githubToolDomain } from './github.tools';
import { neonToolDomain } from './neon.tools';
import { renderToolDomain } from './render.tools';
import { skeletonToolDomain } from './skeleton.tools';
import { stripeToolDomain } from './stripe.tools';
import { verificationToolDomain } from './verification.tools';

export const ENGINEERING_TOOL_DOMAINS: EngineeringToolDomain[] = [
  githubToolDomain,
  renderToolDomain,
  neonToolDomain,
  verificationToolDomain,
  designToolDomain,
  codegraphToolDomain,
  stripeToolDomain,
  skeletonToolDomain,
  aiRagToolDomain,
];

export function getEngineeringToolDomain(toolName: string): string | null {
  return ENGINEERING_TOOL_DOMAINS.find((domain) => domain.toolNames.includes(toolName))?.domain ?? null;
}

export function getRegisteredEngineeringToolNames(): string[] {
  return [...new Set(ENGINEERING_TOOL_DOMAINS.flatMap((domain) => domain.toolNames))].sort();
}
