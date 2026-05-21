import type { EngineeringToolDomain } from './engineering-tool-domain';

export const designToolDomain: EngineeringToolDomain = {
  domain: 'design',
  toolNames: [
    'list_components',
    'read_component',
    'list_design_systems',
    'match_design_system',
    'get_design_system',
    'design_audit',
    'design_critique',
  ],
};
