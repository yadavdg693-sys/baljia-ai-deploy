export interface EngineeringToolDomain {
  domain: string;
  toolNames: readonly string[];
}

export function ownsTool(domain: EngineeringToolDomain, toolName: string): boolean {
  return domain.toolNames.includes(toolName);
}
