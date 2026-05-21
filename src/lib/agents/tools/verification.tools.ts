import type { EngineeringToolDomain } from './engineering-tool-domain';

export const verificationToolDomain: EngineeringToolDomain = {
  domain: 'verification',
  toolNames: [
    'verify_user_journey',
    'verify_db_state',
    'verify_browser_ui',
    'verify_interaction_contract',
    'record_engineering_lane_output',
    'list_journey_templates',
    'static_code_scan',
    'review_pushed_code',
    'read_known_issues',
    'http_fetch_full',
  ],
};
