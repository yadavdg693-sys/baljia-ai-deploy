import type { EngineeringToolDomain } from './engineering-tool-domain';

export const neonToolDomain: EngineeringToolDomain = {
  domain: 'neon',
  toolNames: [
    'provision_database',
    'get_database_info',
    'run_migration',
    'query_company_db',
    'run_drizzle_push',
    'verify_db_state',
  ],
};
