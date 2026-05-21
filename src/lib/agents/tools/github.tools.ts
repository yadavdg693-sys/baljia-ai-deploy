import type { EngineeringToolDomain } from './engineering-tool-domain';

export const githubToolDomain: EngineeringToolDomain = {
  domain: 'github',
  toolNames: [
    'github_create_repo',
    'github_push_file',
    'github_read_file',
    'github_list_files',
    'github_delete_file',
    'github_create_branch',
    'github_create_pr',
    'github_search_code',
    'github_create_commit',
  ],
};
