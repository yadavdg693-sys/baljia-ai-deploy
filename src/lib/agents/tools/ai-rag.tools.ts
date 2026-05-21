import type { EngineeringToolDomain } from './engineering-tool-domain';

export const aiRagToolDomain: EngineeringToolDomain = {
  domain: 'ai-rag',
  toolNames: [
    'match_domain_app',
    'get_domain_pack',
    'compose_ad_hoc_domain',
    'match_capabilities',
    'get_capability_pack',
    'compose_app_architecture',
    'compose_frontend_plan',
    'list_capability_packs',
    'match_reference_repos',
    'get_reference_repo_patterns',
    'retrieve_component_examples',
    'read_known_issues',
  ],
};
