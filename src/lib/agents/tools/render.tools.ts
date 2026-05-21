import type { EngineeringToolDomain } from './engineering-tool-domain';

export const renderToolDomain: EngineeringToolDomain = {
  domain: 'render',
  toolNames: [
    'render_create_service',
    'render_deploy',
    'render_get_service',
    'render_get_deploy_status',
    'render_get_logs',
    'render_rollback',
    'render_delete_service',
    'render_list_services',
    'render_get_metrics',
    'render_list_databases',
    'render_set_env_vars',
    'render_update_service_config',
    'check_url_health',
    'attach_custom_domain',
    'verify_custom_domain',
  ],
};
